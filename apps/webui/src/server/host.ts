import {
  classifyAttachment,
  createAutoPermissionApprover,
  createClient,
  type ClientEvent,
  type MinClient,
} from "@min-agent/client";
import {
  applyAuthToEnv,
  effectiveMaxContextTokens,
  modelIdFromProviderId,
  providerLaunchSpec,
  resolveMinConfig,
} from "@min-agent/config";
import { resolveTurnSubmit } from "./staging.js";
import {
  loadProviderExtensions,
  modelControls,
  resolveProvider,
  type ModelControls,
} from "@min-agent/runtime";
import { executeCommand, modelRows, selectModel, type CommandResult } from "./actions.js";
import { readGitBranch, shortenPath } from "./git.js";
import { formatVersionLine } from "./version.js";
import { routeSubmit, type NamedProviderSpec } from "../shared/commands.js";
import type { ModelRow, ModelView, SessionRow, SubmitResponse, WebSnapshot } from "../shared/types.js";

/**
 * One Node process owns MinClient. The browser only sees HTTP and SSE.
 */

const CWD = process.env.MIN_CWD ?? process.env.INIT_CWD ?? process.cwd();

type Emit = (event: ClientEvent | ViewNotice | ChromeEvent) => void;

export type ViewNotice = {
  type: "notice";
  id: number;
  level: "info" | "warning";
  source: string;
  message: string;
};

export type ChromeEvent = {
  type: "chrome";
  snapshot: WebSnapshot;
};

let emit: Emit = () => {};
let clientPromise: Promise<MinClient> | undefined;
let controls: ModelControls | null = null;
let providers: Record<string, NamedProviderSpec> = {};
let runtimeConfig: {
  maxContextTokens?: number;
  modelContextTokens?: Record<string, number>;
} = {};
let branchCache: { at: number; cwd: string; value?: string } | undefined;

export function setEmitter(fn: Emit): void {
  emit = fn;
}

export async function getClient(): Promise<MinClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      await loadProviderExtensions();
      const { config } = resolveMinConfig({ cwd: CWD });
      applyAuthToEnv(config.auth);
      providers = config.providers;
      runtimeConfig = {
        maxContextTokens: config.runtime.maxContextTokens,
        modelContextTokens: config.runtime.modelContextTokens,
      };
      const launch = providerLaunchSpec(config);
      const provider = resolveProvider({
        provider: process.env.PROVIDER ?? launch.kind ?? config.provider,
        model: process.env.MODEL ?? launch.model ?? config.model,
        reasoningEffort: config.reasoningEffort,
        baseURL: process.env.PROVIDER ? undefined : launch.baseUrl,
        apiKey: launch.apiKeyEnv ? process.env[launch.apiKeyEnv] : undefined,
      });
      controls = modelControls(provider) ?? null;
      const client = await createClient({
        cwd: CWD,
        provider,
        sessionDir: config.runtime.sessionDir,
        maxContextTokens: effectiveMaxContextTokens({
          model: config.model ?? modelIdFromProviderId(provider.id),
          modelContextTokens: config.runtime.modelContextTokens,
          global: config.runtime.maxContextTokens,
        }),
        maxTurns: config.runtime.maxTurns,
        contextStrategy: contextStrategyFrom(config.runtime.contextStrategy),
        noTools: process.env.MIN_NO_TOOLS === "1",
        allowBash:
          process.env.MIN_AUTO === "1" ||
          process.env.MIN_YES === "1" ||
          config.settings.permissions?.bash === "allow",
        askWrite: config.settings.permissions?.write === "ask",
        applyRootGrant: true,
        persistPermissionGrants: process.env.MIN_AUTO !== "1",
        autoApprovePermission:
          process.env.MIN_AUTO === "1"
            ? createAutoPermissionApprover({ mode: "auto" })
            : process.env.MIN_YES === "1"
              ? createAutoPermissionApprover({ mode: "yes" })
              : undefined,
      });
      client.subscribe((event) => emit(event));
      client.notices.subscribe((notice) => emit(noticeEvent(notice)));
      return client;
    })();
  }
  return clientPromise;
}

export function noticeEvent(notice: {
  id: number;
  level: "info" | "warning";
  source: string;
  message: string;
}): ViewNotice {
  return {
    type: "notice",
    id: notice.id,
    level: notice.level,
    source: notice.source,
    message: notice.message,
  };
}

export async function connectionEvents(): Promise<Array<ClientEvent | ViewNotice | ChromeEvent>> {
  const client = await getClient();
  const session = client.getSession();
  const status = client.getStatus();
  const events: Array<ClientEvent | ViewNotice | ChromeEvent> = [
    { type: "status", status: status.status },
  ];
  if (status.context) events.push({ type: "context", usage: status.context });
  events.push({
    type: "session",
    id: session.id,
    title: session.title,
    messageCount: session.messageCount,
    reason: "open",
    messages: session.messages,
  });
  for (const notice of client.notices.list()) events.push(noticeEvent(notice));
  events.push({ type: "chrome", snapshot: await snapshot() });
  return events;
}

export async function snapshot(): Promise<WebSnapshot> {
  const client = await getClient();
  const status = client.getStatus();
  const session = client.getSession();
  const branch = await cachedBranch(status.cwd);
  const selected = controls?.selection();
  const model: ModelView | undefined = selected
    ? {
        kind: selected.kind,
        model: selected.model,
        ...(selected.effort ? { effort: selected.effort } : {}),
      }
    : undefined;
  return {
    status: status.status,
    busy: status.busy,
    provider: status.provider,
    sessionId: session.id,
    ...(session.title ? { title: session.title } : {}),
    messageCount: session.messageCount,
    queueSize: client.queue.size,
    queue: [...client.queue.peek()],
    cwd: status.cwd,
    cwdDisplay: shortenPath(status.cwd),
    ...(branch ? { branch } : {}),
    ...(status.context ? { context: status.context } : {}),
    ...(model ? { model } : {}),
    version: formatVersionLine(),
    skills: [...client.listSkills()],
  };
}

export async function listSessionRows(): Promise<SessionRow[]> {
  const client = await getClient();
  return client.listSessions();
}

export async function listModelRows(): Promise<ModelRow[]> {
  const client = await getClient();
  return modelRows(commandHost(client));
}

export async function submitText(
  text: string,
  attachmentIds: readonly string[] = [],
): Promise<SubmitResponse> {
  const client = await getClient();
  const route = routeSubmit(text, client.getStatus().busy);
  if (route.type === "empty" && attachmentIds.length === 0) {
    return { ok: false, route: "empty", error: "text required" };
  }
  if (route.type === "send" || route.type === "queue" || route.type === "empty") {
    const prompt = route.type === "empty" ? "" : route.text;
    const decision = resolveTurnSubmit({
      text: prompt,
      attachmentIds,
      busy: client.getStatus().busy,
    });
    if (decision.type === "empty") {
      return { ok: false, route: "empty", error: "text required" };
    }
    if (decision.type === "reject") {
      return {
        ok: false,
        route: "blocked",
        level: "error",
        message: "cannot queue attachments while busy",
        snapshot: await snapshot(),
      };
    }
    if (decision.type === "unknown") {
      return {
        ok: false,
        route: "send",
        error: decision.error,
        message: decision.error,
      };
    }
    if (decision.type === "queue") {
      client.queue.push(decision.text);
      const body = { ok: true, route: "queue" as const, snapshot: await snapshot() };
      emit({ type: "chrome", snapshot: body.snapshot });
      return body;
    }
    void client
      .send(decision.text, {
        ...(decision.attachments.length ? { attachments: decision.attachments } : {}),
      })
      .catch((err) => {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return { ok: true, route: "send", snapshot: await snapshot() };
  }
  if (route.type === "busy-blocked") {
    return {
      ok: false,
      route: "blocked",
      level: "error",
      message: `/${route.name} is unavailable while the agent is running`,
      snapshot: await snapshot(),
    };
  }
  try {
    const result = await executeCommand(commandHost(client), route.command);
    const body = responseFrom(result, "command");
    body.snapshot = await snapshot();
    emit({ type: "chrome", snapshot: body.snapshot });
    return body;
  } catch (err) {
    return {
      ok: false,
      route: "command",
      level: "error",
      error: messageOf(err),
      message: messageOf(err),
      snapshot: await snapshot(),
    };
  }
}

export async function openSessionById(id: string): Promise<SubmitResponse> {
  const client = await getClient();
  if (client.getStatus().busy) {
    return {
      ok: false,
      route: "blocked",
      level: "error",
      message: "/resume is unavailable while the agent is running",
      snapshot: await snapshot(),
    };
  }
  try {
    await client.openSession(id);
    const body: SubmitResponse = {
      ok: true,
      route: "command",
      level: "sys",
      message: `resumed ${client.getSession().id}`,
      snapshot: await snapshot(),
    };
    emit({ type: "chrome", snapshot: body.snapshot! });
    return body;
  } catch (err) {
    return { ok: false, route: "command", level: "error", error: messageOf(err), message: messageOf(err) };
  }
}

export async function startSession(): Promise<SubmitResponse> {
  const client = await getClient();
  if (client.getStatus().busy) {
    return {
      ok: false,
      route: "blocked",
      level: "error",
      message: "/new is unavailable while the agent is running",
      snapshot: await snapshot(),
    };
  }
  await client.newSession();
  const body: SubmitResponse = {
    ok: true,
    route: "command",
    level: "sys",
    message: `new session ${client.getSession().id}`,
    snapshot: await snapshot(),
  };
  emit({ type: "chrome", snapshot: body.snapshot! });
  return body;
}

export async function chooseModel(key: string, effort?: string): Promise<SubmitResponse> {
  const client = await getClient();
  const result = selectModel(commandHost(client), key, effort);
  const body = responseFrom(result, "command");
  body.snapshot = await snapshot();
  emit({ type: "chrome", snapshot: body.snapshot });
  return body;
}

export async function disposeClient(): Promise<void> {
  if (!clientPromise) return;
  const client = await clientPromise;
  clientPromise = undefined;
  controls = null;
  await client.dispose();
}

function commandHost(client: MinClient) {
  return {
    versionLine: formatVersionLine(),
    providers,
    controls,
    client,
    runtime: runtimeConfig,
  };
}

function responseFrom(result: CommandResult, route: SubmitResponse["route"]): SubmitResponse {
  return {
    ok: result.level !== "error",
    route,
    ...(result.level ? { level: result.level } : {}),
    ...(result.message ? { message: result.message } : {}),
    ...(result.picker ? { picker: result.picker } : {}),
    ...(result.toggle ? { toggle: result.toggle } : {}),
    ...(result.level === "error" && result.message ? { error: result.message } : {}),
  };
}

async function cachedBranch(cwd: string): Promise<string | undefined> {
  const now = Date.now();
  if (branchCache && branchCache.cwd === cwd && now - branchCache.at < 15_000) {
    return branchCache.value;
  }
  const value = await readGitBranch(cwd);
  branchCache = { at: now, cwd, value };
  return value;
}

function contextStrategyFrom(
  value: string | undefined,
): "trim" | "hmt" | "tool-offload" | "sticky-trim" | "hybrid" | undefined {
  if (
    value === "trim" ||
    value === "hmt" ||
    value === "tool-offload" ||
    value === "sticky-trim" ||
    value === "hybrid"
  ) {
    return value;
  }
  return undefined;
}

export async function readSessionBlob(
  blobId: string,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const client = await getClient();
  const bytes = await client.advanced.runtime.session.blobs.get(blobId);
  const classified = classifyAttachment({ bytes });
  const mediaType =
    classified.kind === "image"
      ? classified.mediaType
      : classified.kind === "document"
        ? "application/pdf"
        : "application/octet-stream";
  return { bytes, mediaType };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
