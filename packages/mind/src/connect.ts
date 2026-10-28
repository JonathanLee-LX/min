import net from "node:net";
import { attachNdjson, sleep, writeNdjson } from "./ipc.js";
import { existingMind } from "./lock.js";
import { mindPaths } from "./paths.js";
import type {
  MindHello,
  MindListResult,
  MindRequestBody,
  MindResponse,
} from "./protocol.js";
import { spawnMindDaemon } from "./spawn.js";
import { MIND_PROTOCOL, mindBuildVersion } from "./version.js";

const ENSURE_TIMEOUT_MS = 12_000;

export interface MindConnection {
  hello: MindHello;
  request<T extends MindResponse>(body: MindRequestBody): Promise<T>;
  close(): void;
}

async function connectSock(sockPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(sockPath);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function openConnection(root: string): Promise<MindConnection> {
  const paths = mindPaths(root);
  const socket = await connectSock(paths.sock);
  let seq = 0;
  const pending = new Map<string, { resolve: (value: MindResponse) => void; reject: (err: Error) => void }>();

  const hello = await new Promise<MindHello>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for mind hello")), 4_000);
    attachNdjson(socket, (value) => {
      const msg = value as MindHello | MindResponse;
      if (msg && typeof msg === "object" && "type" in msg && msg.type === "hello") {
        clearTimeout(timer);
        resolve(msg);
        return;
      }
      const res = msg as MindResponse;
      if (res && typeof res === "object" && "id" in res) {
        const waiter = pending.get(res.id);
        if (!waiter) return;
        pending.delete(res.id);
        waiter.resolve(res);
      }
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  return {
    hello,
    request(body) {
      const id = `m${++seq}`;
      return new Promise((resolve, reject) => {
        pending.set(id, {
          resolve: (value) => resolve(value as never),
          reject,
        });
        writeNdjson(socket, { id, body });
      });
    },
    close() {
      socket.end();
    },
  };
}

export async function waitForMind(root: string, timeoutMs = ENSURE_TIMEOUT_MS): Promise<MindConnection> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      return await openConnection(root);
    } catch (err) {
      lastErr = err;
      await sleep(50);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("mind socket did not come up");
}

/**
 * Connect to the machine-wide mind, spawning it on first use.
 * Same protocol + different build version: stop the old mind (not clients)
 * and start this package's binary, which then claims live clients.
 */
export async function ensureMind(root?: string): Promise<MindConnection> {
  const paths = mindPaths(root);
  const ours = mindBuildVersion();

  const tryExisting = async (): Promise<MindConnection | "replace" | "spawn"> => {
    const existing = await existingMind(paths.root);
    if (!existing) return "spawn";
    if (!existing.socketReady) {
      try {
        return await waitForMind(paths.root, 6_000);
      } catch {
        return "spawn";
      }
    }
    try {
      const conn = await openConnection(paths.root);
      if (conn.hello.protocol !== MIND_PROTOCOL) {
        conn.close();
        return "replace";
      }
      if (conn.hello.buildVersion !== ours) {
        conn.close();
        return "replace";
      }
      return conn;
    } catch {
      return "spawn";
    }
  };

  let state = await tryExisting();
  if (state === "replace") {
    try {
      const conn = await openConnection(paths.root);
      await conn.request({ op: "stop" });
      conn.close();
    } catch {
      const existing = await existingMind(paths.root);
      if (existing) {
        try {
          process.kill(existing.pid, "SIGTERM");
        } catch {
          // ignore
        }
      }
    }
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      const still = await existingMind(paths.root);
      if (!still) break;
      await sleep(40);
    }
    state = "spawn";
  }

  if (state === "spawn") {
    spawnMindDaemon({ root: paths.root }).unref();
    return waitForMind(paths.root);
  }
  return state;
}

export async function mindCreate(
  body: Extract<MindRequestBody, { op: "create" }>,
  root?: string,
): Promise<{ sessionId: string; address: string }> {
  const conn = await ensureMind(root);
  try {
    const res = await conn.request<MindResponse>(body);
    if (!res.ok || res.op !== "create") {
      throw new Error(!res.ok ? res.error : "create failed");
    }
    return { sessionId: res.sessionId, address: res.address };
  } finally {
    conn.close();
  }
}

export async function mindLookup(
  sessionId: string,
  root?: string,
): Promise<{ sessionId: string; address: string } | null> {
  const conn = await ensureMind(root);
  try {
    const res = await conn.request<MindResponse>({ op: "lookup", sessionId });
    if (!res.ok) throw new Error(res.error);
    if (res.op === "lookup-miss") return null;
    if (res.op !== "lookup") throw new Error("lookup failed");
    return { sessionId: res.sessionId, address: res.address };
  } finally {
    conn.close();
  }
}

export async function mindDestroy(sessionId: string, root?: string): Promise<void> {
  const conn = await ensureMind(root);
  try {
    const res = await conn.request<MindResponse>({ op: "destroy", sessionId });
    if (!res.ok) throw new Error(res.error);
  } finally {
    conn.close();
  }
}

export async function mindList(cwd: string, root?: string): Promise<MindListResult> {
  const conn = await ensureMind(root);
  try {
    const res = await conn.request<MindResponse>({ op: "list", cwd });
    if (!res.ok || res.op !== "list") {
      throw new Error(!res.ok ? res.error : "list failed");
    }
    return res.result;
  } finally {
    conn.close();
  }
}

export async function openLease(
  sessionId: string,
  root?: string,
): Promise<{ release(): void }> {
  const conn = await ensureMind(root);
  const res = await conn.request<MindResponse>({ op: "lease", sessionId });
  if (!res.ok) {
    conn.close();
    throw new Error(res.error);
  }
  return {
    release() {
      conn.close();
    },
  };
}
