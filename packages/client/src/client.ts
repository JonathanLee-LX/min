import { noticeLog, type RunEvent, type ToolCallPart } from "@min-agent/core";
import {
  createRuntime,
  type Runtime,
  type RuntimeOptions,
} from "@min-agent/runtime";
import { defineSessionExtension } from "@min-agent/session";
import { createEventTranslator, isAbortError } from "./events.js";
import { createPermissionBridge } from "./permission-bridge.js";
import type {
  ClientEvent,
  ClientEventHandler,
  ClientOptions,
  ClientSessionInfo,
  ClientStatus,
  ClientStatusSnapshot,
  MinClient,
  PermissionAnswer,
  SendOptions,
  SessionEventReason,
} from "./types.js";

interface PermissionRequest {
  toolCall: ToolCallPart;
  reason: string;
  grantRoot?: string;
}

interface FactoryOpts {
  runtimeOpts: RuntimeOptions;
  onBusySend: "queue" | "reject";
  autoApprovePermission: ClientOptions["autoApprovePermission"];
  mapEvent?: ClientOptions["mapEvent"];
  applyRootGrant: boolean;
  persistPermissionGrants: boolean;
  permissionTimeoutMs: number;
}

export async function createClient(
  options: ClientOptions = {},
): Promise<MinClient> {
  const factory = resolveFactory(options);
  /** Shared with send() so follow-up drains can flush the prior assistant turn. */
  const turnBuf = { text: "", thinking: "" };

  const flushThinking = () => {
    if (!turnBuf.thinking) return;
    emit({ type: "thinking_done", text: turnBuf.thinking });
    turnBuf.thinking = "";
  };

  const incomingBridge = {
    emit: (_texts: string[]) => {
      /* assigned after emit exists */
    },
  };

  const withBridge = (
    exts: RuntimeOptions["sessionExtensions"],
  ): RuntimeOptions["sessionExtensions"] => [
    ...(exts ?? []),
    defineSessionExtension({
      name: "min-client-bridge",
      hooks: {
        onIncoming: (texts) => {
          incomingBridge.emit(texts);
        },
        onAfterAssemble({ assemble }) {
          if (assemble.usage) {
            emit({ type: "context", usage: assemble.usage });
          }
          return assemble;
        },
      },
    }),
  ];

  let runtime: Runtime = options.runtime
    ? options.runtime
    : await createRuntime({
        ...factory.runtimeOpts,
        sessionExtensions: withBridge(factory.runtimeOpts.sessionExtensions),
      });

  const listeners = new Set<ClientEventHandler>();
  const noticeUnsubs = new Set<() => void>();
  const translator = createEventTranslator();
  let status: ClientStatus = "idle";
  let abortController: AbortController | undefined;
  let runLock = false;

  const emit = (event: ClientEvent) => {
    const next = factory.mapEvent ? factory.mapEvent(event) : event;
    if (!next) return;
    for (const h of listeners) {
      try {
        h(next);
      } catch {
        // UI handlers must not break the run loop.
      }
    }
  };

  incomingBridge.emit = (texts) => {
    // Session drains the queue between agent passes — finalize the previous
    // assistant turn before announcing follow-up texts.
    flushThinking();
    if (turnBuf.text) {
      emit({ type: "assistant_done", text: turnBuf.text });
      turnBuf.text = "";
    }
    emit({ type: "follow_up", texts: [...texts] });
  };

  const setStatus = (next: ClientStatus) => {
    if (status === next) return;
    status = next;
    emit({ type: "status", status: next });
  };

  const emitSession = (
    reason: SessionEventReason,
    opts?: { includeMessages?: boolean },
  ) => {
    const s = runtime.session;
    emit({
      type: "session",
      id: s.id,
      title: s.meta.title,
      messageCount: s.messages.length,
      reason,
      ...(opts?.includeMessages ? { messages: s.messages } : {}),
    });
  };

  const assertOwnedRuntime = (action: string) => {
    if (options.runtime) {
      throw new Error(
        `${action} requires createClient to own the Runtime (do not inject runtime)`,
      );
    }
  };

  const rebuildRuntime = async (sessionId: string | undefined) => {
    await runtime.session.dispose();
    await runtime.agent.dispose();
    factory.runtimeOpts = {
      ...factory.runtimeOpts,
      sessionId,
    };
    runtime = await createRuntime({
      ...factory.runtimeOpts,
      sessionId,
      sessionExtensions: withBridge(factory.runtimeOpts.sessionExtensions),
    });
  };

  const permissionsBridge = createPermissionBridge({
    timeoutMs: factory.permissionTimeoutMs,
    onAsk: (pending) => {
      setStatus("asking");
      emit({
        type: "permission",
        id: pending.id,
        reason: pending.reason,
        toolCall: pending.toolCall,
        grantRoot: pending.grantRoot,
      });
    },
  });

  const applyAnswer = (req: PermissionRequest, answer: PermissionAnswer) => {
    if (answer === "allow" || answer === "allow_session") {
      const persist =
        answer === "allow_session" && factory.persistPermissionGrants;
      if (req.grantRoot && factory.applyRootGrant) {
        runtime.permissions?.grantRoot(req.grantRoot, { persist });
      }
      if (answer === "allow_session") {
        runtime.permissions?.grantSession(req.toolCall, { persist });
      }
    }
    return answer;
  };

  const handlePermissionAsk = async (
    req: PermissionRequest,
  ): Promise<PermissionAnswer> => {
    const auto = factory.autoApprovePermission;
    if (auto === true) {
      return applyAnswer(req, "allow");
    }
    if (typeof auto === "function") {
      return applyAnswer(req, await auto(req));
    }

    const answer = await permissionsBridge.ask(req);
    if (status === "asking") setStatus("running");
    return applyAnswer(req, answer);
  };

  const queueApi: MinClient["queue"] = {
    get size() {
      return runtime.session.inputQueue?.size ?? 0;
    },
    push(text, opts) {
      const q = runtime.session.inputQueue;
      if (!q) {
        throw new Error("input queue is disabled on this session");
      }
      q.push(text, opts);
      emit({ type: "queued", text: text.trim(), queueSize: q.size });
    },
    peek() {
      return runtime.session.inputQueue?.peek() ?? [];
    },
    clear() {
      runtime.session.inputQueue?.clear();
    },
  };

  const getStatus = (): ClientStatusSnapshot => ({
    status,
    busy: status !== "idle",
    provider: runtime.agent.provider.id,
    sessionId: runtime.session.id,
    queueSize: runtime.session.inputQueue?.size ?? 0,
    cwd: runtime.cwd,
    context: runtime.session.lastAssemble?.usage,
  });

  const getSession = (): ClientSessionInfo => ({
    id: runtime.session.id,
    title: runtime.session.meta.title,
    messageCount: runtime.session.messages.length,
    messages: runtime.session.messages,
  });

  const send = async (text: string, opts: SendOptions = {}): Promise<void> => {
    const prompt = text.trim();
    const attachments = opts.attachments ?? [];
    if (!prompt && attachments.length === 0) return;

    if (runLock) {
      if (attachments.length > 0) {
        throw new Error("cannot queue attachments while busy");
      }
      if (factory.onBusySend === "reject") {
        throw new Error("client is busy");
      }
      queueApi.push(prompt);
      return;
    }

    runLock = true;
    translator.reset();
    abortController = new AbortController();
    const external = opts.signal;
    const onAbort = () => abortController?.abort();
    external?.addEventListener("abort", onAbort);
    if (external?.aborted) abortController.abort();

    setStatus("running");
    turnBuf.text = "";
    turnBuf.thinking = "";

    try {
      const result = await runtime.session.run(prompt, {
        signal: abortController.signal,
        ...(attachments.length ? { attachments } : {}),
        onEvent: (event: RunEvent) => {
          if (event.type === "thinking_delta") {
            turnBuf.thinking += event.text;
          } else if (event.type === "text_delta") {
            flushThinking();
            turnBuf.text += event.text;
          } else if (event.type === "tool_call") {
            flushThinking();
          }
          for (const ce of translator.push(event)) {
            emit(ce);
          }
        },
        onPermissionAsk: async (req) => {
          if (abortController?.signal.aborted) return "deny";
          return handlePermissionAsk(req);
        },
      });

      flushThinking();
      const finalText = turnBuf.text || result.text;
      if (finalText) {
        emit({ type: "assistant_done", text: finalText });
        turnBuf.text = "";
      }
      emitSession("update");
    } catch (err) {
      if (isAbortError(err)) {
        emit({ type: "error", message: "aborted", aborted: true });
      } else {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      external?.removeEventListener("abort", onAbort);
      permissionsBridge.rejectAll("deny");
      abortController = undefined;
      runLock = false;
      setStatus("idle");
    }
  };

  const client: MinClient = {
    queue: queueApi,

    send,
    abort() {
      abortController?.abort();
      permissionsBridge.rejectAll("deny");
    },

    async dispose() {
      client.abort();
      for (const unsub of noticeUnsubs) unsub();
      noticeUnsubs.clear();
      await runtime.session.dispose();
      await runtime.agent.dispose();
      listeners.clear();
    },

    notices: {
      list() {
        return noticeLog.list();
      },
      subscribe(handler) {
        const unsub = noticeLog.subscribe(handler);
        noticeUnsubs.add(unsub);
        return () => {
          unsub();
          noticeUnsubs.delete(unsub);
        };
      },
    },

    getStatus,
    subscribe(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },

    respondPermission(id, answer) {
      permissionsBridge.respond(id, answer);
    },

    reset() {
      runtime.session.reset();
      emitSession("reset", { includeMessages: true });
    },

    getSession,

    async listSessions() {
      const store = runtime.store;
      if (!store) return [];
      return store.list();
    },

    async renameSession(title: string) {
      if (runLock) throw new Error("cannot rename session while busy");
      await runtime.session.rename(title);
      emitSession("rename");
    },

    async generateSessionTitle() {
      if (runLock) throw new Error("cannot rename session while busy");
      runLock = true;
      abortController = new AbortController();
      setStatus("running");
      try {
        const title = await runtime.session.generateTitle({
          signal: abortController.signal,
        });
        emitSession("rename");
        return title;
      } finally {
        abortController = undefined;
        runLock = false;
        setStatus("idle");
      }
    },

    async openSession(id: string) {
      if (runLock) {
        throw new Error("cannot switch session while busy");
      }
      assertOwnedRuntime("openSession");
      const trimmed = id.trim();
      if (!trimmed) throw new Error("session id required");
      const resolved = await resolveSessionId(runtime, trimmed);
      if (resolved === runtime.session.id) return;
      await rebuildRuntime(resolved);
      emitSession("open", { includeMessages: true });
    },

    async newSession() {
      if (runLock) {
        throw new Error("cannot start a new session while busy");
      }
      assertOwnedRuntime("newSession");
      await rebuildRuntime(undefined);
      emitSession("new", { includeMessages: true });
    },

    async compact(opts = {}) {
      if (runLock) {
        throw new Error("cannot compact while busy");
      }
      const result = await runtime.session.compact(opts);
      emitSession("compact", { includeMessages: true });
      return {
        summary: result.summary,
        droppedMessageCount: result.droppedMessageCount,
        keptTurns: result.keptTurns,
        messageCount: runtime.session.messages.length,
      };
    },

    advanced: {
      get runtime() {
        return runtime;
      },
    },
  };

  return client;
}

/**
 * Exact id, or a unique prefix of the current session or a stored one.
 * Does not create a session.
 */
async function resolveSessionId(runtime: Runtime, query: string): Promise<string> {
  const current = runtime.session.id;
  const stored = runtime.store ? await runtime.store.list() : [];
  const ids = [...new Set([current, ...stored.map((meta) => meta.id)])];
  if (ids.includes(query)) return query;
  const matches = ids.filter((id) => id.startsWith(query)).sort();
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    const shown = matches.slice(0, 5);
    const more =
      matches.length > shown.length ? ` (+${matches.length - shown.length} more)` : "";
    throw new Error(`session id is ambiguous: ${shown.join(", ")}${more}`);
  }
  throw new Error(`no session matches ${query}`);
}

function resolveFactory(options: ClientOptions): FactoryOpts {
  if (!options.runtime && !options.provider) {
    throw new Error("createClient requires `provider` or an injected `runtime`");
  }

  const runtimeOpts: RuntimeOptions = {
    cwd: options.cwd ?? process.cwd(),
    provider: options.provider!,
    sessionId: options.sessionId,
    sessionDir: options.sessionDir,
    noSessionStore: options.noSessionStore,
    noTools: options.noTools,
    skillsDir: options.skillsDir,
    addRoots: options.addRoots,
    askWrite: options.askWrite,
    allowBash: options.allowBash,
    maxContextTokens: options.maxContextTokens,
    maxUserTurns: options.maxUserTurns,
    maxTurns: options.maxTurns,
    contextStrategy: options.contextStrategy,
    sessionExtensions: options.sessionExtensions,
  };

  return {
    runtimeOpts,
    onBusySend: options.onBusySend ?? "queue",
    autoApprovePermission: options.autoApprovePermission,
    mapEvent: options.mapEvent,
    applyRootGrant: options.applyRootGrant ?? true,
    persistPermissionGrants: options.persistPermissionGrants !== false,
    permissionTimeoutMs: options.permissionTimeoutMs ?? 120_000,
  };
}
