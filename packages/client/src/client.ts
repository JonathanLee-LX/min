import {
  messageText,
  type Message,
  type RunEvent,
  type ToolCallPart,
  type ToolResultPart,
} from "@min-agent/core";
import {
  createRuntime,
  type Runtime,
  type RuntimeOptions,
} from "@min-agent/runtime";
import {
  defineSessionExtension,
  type SessionSnapshot,
} from "@min-agent/session";
import { createEventTranslator, isAbortError } from "./events.js";
import { createPermissionBridge } from "./permission-bridge.js";
import { assembleStopMessages } from "./stop-snapshot.js";
import type {
  ClientEvent,
  ClientEventHandler,
  ClientOptions,
  ClientSessionInfo,
  ClientStatus,
  ClientStatusSnapshot,
  MinClient,
  PermissionAnswer,
  PendingPermissionSnapshot,
  SendOptions,
  SessionEventReason,
  SessionHandoff,
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

export interface ClientHost {
  handoff(): SessionHandoff;
  /** True after the stop path has begun. New connections and requests are refused. */
  readonly closing: boolean;
  /**
   * Stop path: freeze the in-flight turn, abort, call `onBeforeShutdown`,
   * persist, then return. Does not delete the mind registry — the process does.
   */
  shutdown(opts?: { hookTimeoutMs?: number }): Promise<void>;
}

const hosts = new WeakMap<MinClient, ClientHost>();

/** In-process controls for the session process. Not part of the UI surface. */
export function getClientHost(client: MinClient): ClientHost {
  const host = hosts.get(client);
  if (!host) throw new Error("client has no host controls");
  return host;
}

export async function createClient(
  options: ClientOptions = {},
): Promise<MinClient> {
  const factory = resolveFactory(options);
  /** Shared with send() so follow-up drains can flush the prior assistant turn. */
  const turnBuf = { text: "", thinking: "" };
  /** Assistant text of the completion the Runner has not pushed yet. */
  let segmentText = "";
  /** Latest Runner transcript for the in-flight turn. */
  let transcript: readonly Message[] | null = null;
  /** User text passed to the current send, before the Runner publishes. */
  let turnUser = "";
  /** Tool results observed during the in-flight turn. */
  let seenToolResults: ToolResultPart[] = [];
  let lastRunAborted = false;
  let closing = false;
  const inflight = new Set<Promise<void>>();

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

  const runtime: Runtime = options.runtime
    ? options.runtime
    : await createRuntime({
        ...factory.runtimeOpts,
        sessionExtensions: withBridge(factory.runtimeOpts.sessionExtensions),
      });

  const listeners = new Set<ClientEventHandler>();
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
    segmentText = "";
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
    onDecision: (id, answer) => {
      emit({ type: "permission_decision", id, answer });
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
      if (closing) return;
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

  const handoff = (): SessionHandoff => {
    const messages = runtime.session.messages.map((message) =>
      structuredClone(message),
    );
    let userText: string | undefined;
    const liveUser = currentUserText();
    if (
      liveUser &&
      !messages.some(
        (message) =>
          message.role === "user" && messageText(message) === liveUser,
      )
    ) {
      userText = liveUser;
    }
    const permissions: PendingPermissionSnapshot[] = permissionsBridge
      .list()
      .map((pending) => ({
        id: pending.id,
        reason: pending.reason,
        toolCall: pending.toolCall,
        grantRoot: pending.grantRoot,
      }));
    return {
      messages,
      title: runtime.session.meta.title,
      turn: {
        text: turnBuf.text,
        thinking: turnBuf.thinking,
        ...(userText ? { userText } : {}),
      },
      permissions,
      status: getStatus(),
    };
  };

  function currentUserText(): string {
    if (transcript) {
      for (let i = transcript.length - 1; i >= 0; i--) {
        const message = transcript[i];
        if (message?.role === "user") return messageText(message);
      }
    }
    return turnUser;
  }

  const captureStopSnapshot = (): SessionSnapshot => {
    const messages = assembleStopMessages({
      committed: runtime.session.messages,
      transcript,
      partialText: segmentText,
      toolResults: seenToolResults,
      queued: queueApi.peek(),
      userText: turnUser,
    });
    let meta = { ...runtime.session.meta };
    if (!meta.title) {
      const user = messages.find((message) => message.role === "user");
      const text = user ? messageText(user).trim() : "";
      if (text) meta = { ...meta, title: text.slice(0, 80) };
    }
    return { meta, messages };
  };

  const runSend = async (text: string, opts: SendOptions): Promise<void> => {
    const prompt = text.trim();
    if (!prompt || closing) return;

    if (runLock) {
      if (factory.onBusySend === "reject") {
        throw new Error("client is busy");
      }
      queueApi.push(prompt);
      return;
    }

    runLock = true;
    lastRunAborted = false;
    translator.reset();
    abortController = new AbortController();
    const external = opts.signal;
    const onAbort = () => abortController?.abort();
    external?.addEventListener("abort", onAbort);
    if (external?.aborted) abortController.abort();

    setStatus("running");
    turnBuf.text = "";
    turnBuf.thinking = "";
    segmentText = "";
    transcript = null;
    turnUser = prompt;
    seenToolResults = [];

    try {
      const result = await runtime.session.run(prompt, {
        signal: abortController.signal,
        onTranscript: (messages) => {
          transcript = messages;
        },
        onEvent: (event: RunEvent) => {
          if (event.type === "thinking_delta") {
            turnBuf.thinking += event.text;
          } else if (event.type === "text_delta") {
            flushThinking();
            turnBuf.text += event.text;
            segmentText += event.text;
          } else if (event.type === "tool_call") {
            flushThinking();
          } else if (event.type === "turn_end") {
            segmentText = "";
          } else if (event.type === "tool_result") {
            seenToolResults.push({
              type: "tool_result",
              toolCallId: event.toolCallId,
              content: event.content,
              isError: event.isError,
            });
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
      segmentText = "";
      emitSession("update");
    } catch (err) {
      if (isAbortError(err)) {
        lastRunAborted = true;
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
      if (!closing) {
        transcript = null;
        turnUser = "";
        segmentText = "";
        seenToolResults = [];
      }
      setStatus("idle");
    }
  };

  const send = (text: string, opts: SendOptions = {}): Promise<void> => {
    const task = runSend(text, opts);
    inflight.add(task);
    return task.finally(() => {
      inflight.delete(task);
    });
  };

  const abortRun = () => {
    abortController?.abort();
    permissionsBridge.rejectAll("deny");
  };

  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (opts?: { hookTimeoutMs?: number }): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      closing = true;
      const wasRunning = inflight.size > 0;
      const frozen = captureStopSnapshot();
      if (wasRunning) abortRun();
      await Promise.all([...inflight]);
      const snapshot =
        wasRunning && !lastRunAborted
          ? captureStopSnapshot()
          : frozen;
      await invokeShutdownHook(
        options.onBeforeShutdown,
        snapshot,
        opts?.hookTimeoutMs ?? 2_000,
      );
      const stable = structuredClone(snapshot);
      try {
        await runtime.session.commitSnapshot(stable);
      } catch {
        // Persist failure still exits. The next create reloads the last good file.
      }
      try {
        await runtime.agent.dispose();
      } catch {
        // The process is leaving either way.
      }
      listeners.clear();
    })();
    return shutdownPromise;
  };

  const client: MinClient = {
    queue: queueApi,

    send,
    abort() {
      if (closing) return;
      abortRun();
    },

    async dispose() {
      client.abort();
      await runtime.session.dispose();
      await runtime.agent.dispose();
      listeners.clear();
    },

    getStatus,
    subscribe(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },

    respondPermission(id, answer) {
      if (closing) return;
      permissionsBridge.respond(id, answer);
    },

    reset() {
      if (closing || runLock) return;
      runtime.session.reset();
      emitSession("reset", { includeMessages: true });
    },

    getSession,

    async listSessions() {
      const store = runtime.store;
      if (!store) return [];
      return store.list();
    },

    async compact(opts = {}) {
      if (closing) {
        throw new Error("client is closing");
      }
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

  const host: ClientHost = {
    handoff,
    get closing() {
      return closing;
    },
    shutdown,
  };
  hosts.set(client, host);

  return client;
}

async function invokeShutdownHook(
  hook: ClientOptions["onBeforeShutdown"],
  snapshot: SessionSnapshot,
  timeoutMs: number,
): Promise<void> {
  if (!hook) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve()
        .then(() => hook(snapshot))
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
