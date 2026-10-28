import { type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import { readNdjson, writeNdjson } from "./ndjson.js";
import {
  clientSocketPath,
  mindLockDir,
  mindPidPath,
  mindSocketPath,
  newSessionId,
  SESSION_ID_RE,
  sessionRegistryDir,
} from "./paths.js";
import { PROTOCOL } from "./protocol.js";
import {
  canConnect,
  inspectSession,
  listSessionIds,
  pidAlive,
  readHistory,
  readRecord,
  removeRecord,
  type SessionAddress,
} from "./registry.js";
import { spawnNode } from "./spawn.js";

interface PidInfo {
  pid: number;
  protocol: number;
  buildVersion: string;
}

interface LeaseState {
  count: number;
  timer?: ReturnType<typeof setTimeout>;
}

interface LaunchRequest {
  cwd?: string;
  provider?: string;
  model?: string;
  autoApprove?: boolean;
  approveMode?: "yes" | "auto";
  allowRootGrant?: boolean;
  persistPermissionGrants?: boolean;
  noTools?: boolean;
  allowBash?: boolean;
  askWrite?: boolean;
  skillsDir?: string;
  addRoots?: string[];
  maxContextTokens?: number;
  maxUserTurns?: number;
  maxTurns?: number;
  contextStrategy?: string;
  sessionDir?: string;
  noSessionStore?: boolean;
  sessionId?: string;
}

const home = argValue("--home") || "";
const clientEntry = argValue("--client-entry") || "";
const buildVersion = argValue("--build-version") || "unknown";
const graceMs = positiveInt(process.env.MIND_DRAIN_GRACE_MS, 5_000);
const createTimeoutMs = positiveInt(process.env.MIND_CREATE_TIMEOUT_MS, 15_000);
const destroyWaitMs = 10_000;

const leases = new Map<string, LeaseState>();
const leaseOwner = new Map<Socket, string>();
const creating = new Map<string, Promise<SessionAddress>>();
let listening: Server | undefined;
let mindStopping = false;

if (!home || !clientEntry) {
  console.error("mind requires --home and --client-entry");
  process.exit(1);
}

await run();

async function run(): Promise<void> {
  await mkdir(home, { recursive: true });
  const gate = await acquire();
  if (gate === "running") process.exit(0);

  const sockPath = mindSocketPath(home);
  await unlink(sockPath).catch(() => undefined);
  const server = createServer((socket) => onSocket(socket));
  listening = server;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(sockPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  await writePid();
  await sweep();

  const shutdown = () => {
    void shutdownMind();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function acquire(): Promise<"acquired" | "running"> {
  const lock = mindLockDir(home);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await healthy()) return "running";
    try {
      await mkdir(lock);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      if (await healthy()) return "running";
      const info = await readPid();
      if (info && pidAlive(info.pid)) {
        await sleep(50);
        continue;
      }
      await rm(lock, { recursive: true, force: true }).catch(() => undefined);
      continue;
    }
    if (await healthy()) {
      await rm(lock, { recursive: true, force: true }).catch(() => undefined);
      return "running";
    }
    await unlink(mindSocketPath(home)).catch(() => undefined);
    await unlink(mindPidPath(home)).catch(() => undefined);
    return "acquired";
  }
  if (await healthy()) return "running";
  throw new Error("mind lock timed out");
}

async function healthy(): Promise<boolean> {
  const info = await readPid();
  if (!info || info.pid === process.pid || !pidAlive(info.pid)) return false;
  return canConnect(mindSocketPath(home), 300);
}

async function readPid(): Promise<PidInfo | null> {
  try {
    const parsed = JSON.parse(await readFile(mindPidPath(home), "utf8")) as Partial<PidInfo>;
    if (typeof parsed.pid !== "number") return null;
    return {
      pid: parsed.pid,
      protocol: typeof parsed.protocol === "number" ? parsed.protocol : 0,
      buildVersion: typeof parsed.buildVersion === "string" ? parsed.buildVersion : "",
    };
  } catch {
    return null;
  }
}

async function writePid(): Promise<void> {
  const body: PidInfo = {
    pid: process.pid,
    protocol: PROTOCOL,
    buildVersion,
  };
  await writeFile(mindPidPath(home), JSON.stringify(body), "utf8");
}

async function shutdownMind(): Promise<void> {
  if (mindStopping) return;
  mindStopping = true;
  listening?.close();
  for (const state of leases.values()) {
    if (state.timer) clearTimeout(state.timer);
  }
  await unlink(mindSocketPath(home)).catch(() => undefined);
  await unlink(mindPidPath(home)).catch(() => undefined);
  await rm(mindLockDir(home), { recursive: true, force: true }).catch(() => undefined);
  process.exit(0);
}

async function sweep(): Promise<void> {
  for (const sessionId of await listSessionIds(home)) {
    if (!SESSION_ID_RE.test(sessionId)) continue;
    await inspectSession(home, sessionId);
  }
}

function onSocket(socket: Socket): void {
  readNdjson(socket, (message) => {
    void handle(socket, message).catch((err) => {
      const id = (message as { id?: string })?.id;
      writeNdjson(socket, {
        type: "response",
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
  const release = () => releaseLease(socket);
  socket.on("close", release);
  socket.on("error", release);
}

async function handle(socket: Socket, message: unknown): Promise<void> {
  const req = message as { id?: string; op?: string } & LaunchRequest;
  const id = typeof req.id === "string" ? req.id : undefined;
  const op = req.op;
  if (op === "hello") {
    reply(socket, id, {
      protocol: PROTOCOL,
      buildVersion,
    });
    return;
  }
  if (op === "stop") {
    reply(socket, id, { stopped: true });
    setTimeout(() => {
      void shutdownMind();
    }, 30);
    return;
  }
  if (op === "lookup") {
    const found = await claimed(req.sessionId);
    reply(socket, id, found);
    return;
  }
  if (op === "destroy") {
    if (req.sessionId && SESSION_ID_RE.test(req.sessionId)) {
      await destroySession(req.sessionId);
    }
    reply(socket, id, { stopped: true });
    return;
  }
  if (op === "list") {
    const cwd = path.resolve(req.cwd || process.cwd());
    const live: SessionAddress[] = [];
    for (const sessionId of await listSessionIds(home)) {
      if (!SESSION_ID_RE.test(sessionId)) continue;
      const inspected = await inspectSession(home, sessionId);
      if (inspected.kind === "claimed" && path.resolve(inspected.address.cwd) === cwd) {
        live.push(inspected.address);
      }
    }
    const history = await readHistory(cwd);
    reply(socket, id, { live, history });
    return;
  }
  if (op === "lease") {
    const sessionId = req.sessionId ?? "";
    const found = await claimed(sessionId);
    if (!found) {
      reply(socket, id, undefined, "not_found");
      return;
    }
    holdLease(socket, sessionId);
    reply(socket, id, { sessionId, leases: leases.get(sessionId)?.count ?? 1 });
    return;
  }
  if (op === "create") {
    const address = await createSession(req);
    reply(socket, id, address);
    return;
  }
  reply(socket, id, undefined, `unknown op ${String(op)}`);
}

function reply(
  socket: Socket,
  id: string | undefined,
  result: unknown,
  error?: string,
): void {
  if (!socket.writable) return;
  if (error) {
    writeNdjson(socket, { type: "response", id, ok: false, error });
    return;
  }
  writeNdjson(socket, { type: "response", id, ok: true, result });
}

async function claimed(sessionId: string | undefined): Promise<SessionAddress | null> {
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) return null;
  const inspected = await inspectSession(home, sessionId);
  if (inspected.kind !== "claimed") return null;
  return inspected.address;
}

async function createSession(req: LaunchRequest): Promise<SessionAddress> {
  const cwd = path.resolve(req.cwd || process.cwd());
  const sessionId =
    req.sessionId && req.sessionId.trim() ? req.sessionId.trim() : newSessionId();
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error(`invalid session id: ${sessionId}`);
  }
  const pending = creating.get(sessionId);
  if (pending) return pending;
  const task = startSession(sessionId, cwd, req).finally(() => {
    creating.delete(sessionId);
  });
  creating.set(sessionId, task);
  return task;
}

async function startSession(
  sessionId: string,
  cwd: string,
  req: LaunchRequest,
): Promise<SessionAddress> {
  const existing = await inspectSession(home, sessionId);
  if (existing.kind === "claimed") return existing.address;
  if (existing.kind === "foreign") {
    throw new Error(
      `session ${sessionId} is running an incompatible protocol and was left in place`,
    );
  }

  const registryDir = sessionRegistryDir(home, sessionId);
  await rm(registryDir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(registryDir, { recursive: true });
  const socketPath = clientSocketPath(home, sessionId);
  await mkdir(path.dirname(socketPath), { recursive: true });
  const launch = {
    sessionId,
    cwd,
    provider: req.provider,
    model: req.model,
    autoApprove: req.autoApprove === true,
    approveMode: req.approveMode,
    allowRootGrant: req.allowRootGrant === true,
    persistPermissionGrants: req.persistPermissionGrants,
    noTools: req.noTools === true,
    allowBash: req.allowBash === true,
    askWrite: req.askWrite === true,
    skillsDir: req.skillsDir,
    addRoots: req.addRoots,
    maxContextTokens: req.maxContextTokens,
    maxUserTurns: req.maxUserTurns,
    maxTurns: req.maxTurns,
    contextStrategy: req.contextStrategy,
    sessionDir: req.sessionDir,
    noSessionStore: req.noSessionStore === true,
    socketPath,
    registryDir,
    buildVersion,
    protocol: PROTOCOL,
  };
  const launchPath = path.join(registryDir, "launch.json");
  await writeFile(launchPath, JSON.stringify(launch), "utf8");

  const logFd = openSync(path.join(registryDir, "client.log"), "a");
  let child: ChildProcess;
  try {
    child = spawnNode(clientEntry, ["--launch", launchPath], {
      cwd,
      env: process.env,
      detached: true,
      stdio: ["ignore", "ignore", logFd],
    });
  } finally {
    try {
      closeSync(logFd);
    } catch {
      // already closed
    }
  }
  child.unref();

  let cancelled = false;
  const early = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
  });
  const ready = waitForClaim(sessionId, () => cancelled);
  const timeout = sleep(createTimeoutMs).then(() => "timeout" as const);
  const winner = await Promise.race([
    ready.then(
      (address) => ({ address }) as const,
      () => ({ exit: 1 as number | null }),
    ),
    early.then((code) => ({ exit: code }) as const),
    timeout,
  ]);
  cancelled = true;

  if (winner === "timeout" || "exit" in winner) {
    if (child.pid && pidAlive(child.pid)) {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    await removeRecord(home, sessionId, socketPath);
    const why =
      winner === "timeout"
        ? "timed out"
        : `exited (${winner.exit ?? "signal"})`;
    throw new Error(`client for ${sessionId} ${why} before it registered`);
  }
  return winner.address;
}

async function waitForClaim(
  sessionId: string,
  cancelled: () => boolean,
): Promise<SessionAddress> {
  while (!cancelled()) {
    const record = await readRecord(home, sessionId);
    if (record && record.protocol === PROTOCOL && pidAlive(record.pid)) {
      if (await canConnect(record.socketPath, 500)) {
        return { sessionId, ...record };
      }
    }
    await sleep(40);
  }
  throw new Error("create cancelled");
}

async function destroySession(sessionId: string): Promise<void> {
  const state = leases.get(sessionId);
  if (state?.timer) clearTimeout(state.timer);
  leases.delete(sessionId);
  const record = await readRecord(home, sessionId);
  if (record && pidAlive(record.pid)) {
    try {
      process.kill(record.pid, "SIGTERM");
    } catch {
      // already gone
    }
    const exited = await waitDead(record.pid, destroyWaitMs);
    if (!exited && pidAlive(record.pid)) {
      try {
        process.kill(record.pid, "SIGKILL");
      } catch {
        // already gone
      }
      await waitDead(record.pid, 2_000);
    }
  }
  await removeRecord(home, sessionId, record?.socketPath);
}

function holdLease(socket: Socket, sessionId: string): void {
  const previous = leaseOwner.get(socket);
  if (previous === sessionId) return;
  if (previous) releaseLease(socket);
  leaseOwner.set(socket, sessionId);
  const state = leases.get(sessionId) ?? { count: 0 };
  state.count += 1;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = undefined;
  }
  leases.set(sessionId, state);
}

function releaseLease(socket: Socket): void {
  const sessionId = leaseOwner.get(socket);
  if (!sessionId) return;
  leaseOwner.delete(socket);
  const state = leases.get(sessionId);
  if (!state) return;
  state.count = Math.max(0, state.count - 1);
  if (state.count > 0) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    leases.delete(sessionId);
    void destroySession(sessionId).catch((err) => {
      console.error(err instanceof Error ? err.message : err);
    });
  }, graceMs);
}

async function waitDead(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!pidAlive(pid)) return true;
    await sleep(50);
  }
  return !pidAlive(pid);
}

function argValue(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0) return "";
  return process.argv[index + 1] ?? "";
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
