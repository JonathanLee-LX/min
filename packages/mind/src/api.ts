import { connect, type Socket } from "node:net";
import { mkdir, readFile } from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
import path from "node:path";
import { readNdjson, writeNdjson } from "./ndjson.js";
import {
  mindDaemonPath,
  mindHome,
  mindPidPath,
  mindSocketPath,
  readBuildVersion,
} from "./paths.js";
import { PROTOCOL } from "./protocol.js";
import { pidAlive, type HistoryMeta, type SessionAddress } from "./registry.js";
import { spawnNode } from "./spawn.js";

export interface MindCreateRequest {
  cwd: string;
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
  contextStrategy?:
    | "trim"
    | "hmt"
    | "tool-offload"
    | "sticky-trim"
    | "hybrid";
  sessionDir?: string;
  noSessionStore?: boolean;
  sessionId?: string;
}

export interface MindList {
  live: SessionAddress[];
  history: HistoryMeta[];
}

export interface MindLease {
  close(): void;
}

export interface Mind {
  readonly home: string;
  readonly protocol: number;
  readonly buildVersion: string;
  create(request: MindCreateRequest): Promise<SessionAddress>;
  lookup(sessionId: string): Promise<SessionAddress | null>;
  destroy(sessionId: string): Promise<void>;
  list(cwd: string): Promise<MindList>;
  /** Hold one lease until `close` or the socket drops. */
  lease(sessionId: string): Promise<MindLease>;
  /** Stop mind only. Live session processes keep running. */
  stop(): Promise<void>;
  /** Close this control connection. Does not stop mind or sessions. */
  close(): void;
}

interface Hello {
  protocol: number;
  buildVersion: string;
}

interface EnsureOpts {
  home?: string;
  clientEntry: string;
  buildVersion?: string;
}

/**
 * Connect to the machine mind, starting it when the socket is down.
 * A different build or protocol is stopped (session processes are not) and
 * replaced with this package's daemon, which then claims what it can.
 */
export async function ensureMind(opts: EnsureOpts): Promise<Mind> {
  const home = opts.home ?? mindHome();
  const buildVersion = opts.buildVersion ?? readBuildVersion();
  await mkdir(home, { recursive: true });

  let hello = await tryHello(home);
  if (
    hello &&
    (hello.protocol !== PROTOCOL || hello.buildVersion !== buildVersion)
  ) {
    await stopMindProcess(home, hello.protocol === PROTOCOL);
    await waitUntilDown(home);
    hello = null;
  }
  if (!hello) {
    await spawnDaemon(home, opts.clientEntry, buildVersion);
    hello = await waitHello(home);
  }
  return attach(home, hello);
}

export function mergeSessionList(list: MindList): HistoryMeta[] {
  const byId = new Map(list.history.map((meta) => [meta.id, meta]));
  for (const live of list.live) {
    if (!byId.has(live.sessionId)) {
      byId.set(live.sessionId, {
        id: live.sessionId,
        createdAt: "",
        updatedAt: "",
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function attach(home: string, hello: Hello): Promise<Mind> {
  const socket = await openSocket(home);
  let seq = 0;
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();

  readNdjson(socket, (message) => {
    const frame = message as {
      type?: string;
      id?: string;
      ok?: boolean;
      result?: unknown;
      error?: string;
    };
    if (frame.type !== "response" || !frame.id) return;
    const item = pending.get(frame.id);
    if (!item) return;
    pending.delete(frame.id);
    if (frame.ok) item.resolve(frame.result);
    else item.reject(new Error(frame.error ?? "mind request failed"));
  });
  socket.on("close", () => {
    for (const item of pending.values()) item.reject(new Error("mind socket closed"));
    pending.clear();
  });

  const request = <T>(body: Record<string, unknown>): Promise<T> => {
    if (socket.destroyed) return Promise.reject(new Error("mind socket closed"));
    const id = String(++seq);
    return new Promise<T>((resolve, reject) => {
      pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      writeNdjson(socket, { id, ...body });
    });
  };

  return {
    home,
    protocol: hello.protocol,
    buildVersion: hello.buildVersion,
    create(requestBody) {
      return request<SessionAddress>({ op: "create", ...requestBody });
    },
    async lookup(sessionId) {
      const result = await request<SessionAddress | null>({
        op: "lookup",
        sessionId,
      });
      return result ?? null;
    },
    async destroy(sessionId) {
      await request({ op: "destroy", sessionId });
    },
    list(cwd) {
      return request<MindList>({ op: "list", cwd });
    },
    lease(sessionId) {
      return openLease(home, sessionId);
    },
    async stop() {
      if (!socket.destroyed) {
        const pendingStop = request({ op: "stop" }).catch(() => undefined);
        await Promise.race([pendingStop, sleep(400)]);
      }
      socket.destroy();
      const info = await readPidFile(home);
      if (info && pidAlive(info.pid)) {
        try {
          process.kill(info.pid, "SIGTERM");
        } catch {
          // already gone
        }
      }
      await waitUntilDown(home);
    },
    close() {
      socket.end();
      socket.destroy();
    },
  };
}

async function openLease(home: string, sessionId: string): Promise<MindLease> {
  const socket = await openSocket(home);
  const result = await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("mind lease timed out"));
    }, 5_000);
    readNdjson(socket, (message) => {
      const frame = message as { ok?: boolean; error?: string };
      clearTimeout(timer);
      if (frame.ok) resolve();
      else {
        socket.destroy();
        reject(new Error(frame.error ?? "lease failed"));
      }
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    writeNdjson(socket, { id: "lease", op: "lease", sessionId });
  });
  void result;
  return {
    close() {
      socket.end();
      socket.destroy();
    },
  };
}

async function tryHello(home: string): Promise<Hello | null> {
  try {
    const socket = await openSocket(home, 400);
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(null);
      }, 800);
      readNdjson(socket, (message) => {
        const frame = message as { ok?: boolean; result?: Hello };
        clearTimeout(timer);
        socket.end();
        socket.destroy();
        if (frame.ok && frame.result && typeof frame.result.protocol === "number") {
          resolve(frame.result);
          return;
        }
        resolve(null);
      });
      socket.once("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
      writeNdjson(socket, { id: "hello", op: "hello" });
    });
  } catch {
    return null;
  }
}

async function waitHello(home: string): Promise<Hello> {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    const hello = await tryHello(home);
    if (hello) return hello;
    await sleep(40);
  }
  throw new Error("mind did not start listening");
}

async function spawnDaemon(
  home: string,
  clientEntry: string,
  buildVersion: string,
): Promise<void> {
  const logPath = path.join(home, "mind.log");
  const logFd = openSync(logPath, "a");
  const child = spawnNode(
    mindDaemonPath(),
    [
      "--home",
      home,
      "--client-entry",
      clientEntry,
      "--build-version",
      buildVersion,
    ],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    },
  );
  child.unref();
  try {
    closeSync(logFd);
  } catch {
    // The child inherited the fd.
  }
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
  });
  const hello = await Promise.race([
    waitHello(home).then((value) => ({ hello: value })),
    exited.then((code) => ({ code })),
  ]);
  if ("code" in hello && hello.code && hello.code !== 0) {
    throw new Error(`mind exited ${hello.code} before listening`);
  }
}

async function stopMindProcess(home: string, speakable: boolean): Promise<void> {
  if (speakable) {
    try {
      const socket = await openSocket(home, 500);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          socket.destroy();
          resolve();
        }, 1_000);
        readNdjson(socket, () => {
          clearTimeout(timer);
          socket.destroy();
          resolve();
        });
        writeNdjson(socket, { id: "stop", op: "stop" });
      });
    } catch {
      // Fall through to the pid.
    }
  }
  const info = await readPidFile(home);
  if (info && pidAlive(info.pid)) {
    try {
      process.kill(info.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

async function waitUntilDown(home: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 5_000) {
    const info = await readPidFile(home);
    const alive = info ? pidAlive(info.pid) : false;
    if (!alive) {
      const up = await tryHello(home);
      if (!up) return;
    }
    await sleep(40);
  }
}

async function readPidFile(
  home: string,
): Promise<{ pid: number } | null> {
  try {
    const parsed = JSON.parse(await readFile(mindPidPath(home), "utf8")) as {
      pid?: number;
    };
    if (typeof parsed.pid !== "number") return null;
    return { pid: parsed.pid };
  } catch {
    return null;
  }
}

function openSocket(home: string, timeoutMs = 2_000): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(mindSocketPath(home));
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("mind socket timed out"));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
