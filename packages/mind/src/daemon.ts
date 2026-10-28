import { createFsStore, newSessionId } from "@min-agent/session";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { attachNdjson, isPidAlive, sleep, writeNdjson } from "./ipc.js";
import { acquireMindLock, releaseMindLock, type MindLock } from "./lock.js";
import {
  createTimeoutMs,
  destroyWaitMs,
  drainGraceMs,
  mindPaths,
  workspaceSessionDir,
} from "./paths.js";
import type {
  ClientRecord,
  LiveClientInfo,
  MindHello,
  MindListResult,
  MindRequest,
  MindRequestBody,
  MindResponse,
  PermissionMode,
} from "./protocol.js";
import {
  claimRecords,
  readClientRecord,
  recordIsLive,
  removeClientRecord,
  socketConnectable,
} from "./registry.js";
import { permissionModeOf, spawnClientProcess, type SpawnClientOptions } from "./spawn.js";
import { MIND_PROTOCOL, mindBuildVersion } from "./version.js";

export type SpawnClientFn = (opts: SpawnClientOptions) => {
  pid?: number;
  unref?: () => void;
  once?: (event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) => void;
};

export interface MindDaemonOptions {
  root?: string;
  spawnClient?: SpawnClientFn;
  drainMs?: number;
  destroyMs?: number;
  createMs?: number;
  /** Install SIGTERM/SIGINT handlers that exit this process. Default false. */
  installSignals?: boolean;
}

type LeaseConn = net.Socket;

export interface MindDaemon {
  readonly root: string;
  close(): Promise<void>;
}

export async function startMindDaemon(opts: MindDaemonOptions = {}): Promise<MindDaemon> {
  const paths = mindPaths(opts.root);
  await mkdir(paths.root, { recursive: true });

  const locked = await acquireMindLock(paths.root);
  if (locked.status === "running") {
    throw new Error("mind already running");
  }
  const lock: MindLock = locked.lock;

  const table = new Map<string, ClientRecord>();
  const leases = new Map<string, Set<LeaseConn>>();
  const drains = new Map<string, ReturnType<typeof setTimeout>>();
  const spawnClient = opts.spawnClient ?? ((o: SpawnClientOptions) => spawnClientProcess(o));
  const drainMs = opts.drainMs ?? drainGraceMs();
  const destroyMs = opts.destroyMs ?? destroyWaitMs();
  const createMs = opts.createMs ?? createTimeoutMs();

  const claimed = await claimRecords(paths.root, MIND_PROTOCOL);
  for (const record of claimed.claimed) {
    table.set(record.sessionId, record);
  }

  const liveInfo = (record: ClientRecord): LiveClientInfo => ({
    sessionId: record.sessionId,
    address: record.socket,
    pid: record.pid,
    cwd: record.cwd,
    protocol: record.protocol,
    buildVersion: record.buildVersion,
    provider: record.provider,
    autoApprove: record.autoApprove,
  });

  const verifyLive = async (sessionId: string): Promise<ClientRecord | undefined> => {
    const record = table.get(sessionId);
    if (!record) return undefined;
    if (record.protocol !== MIND_PROTOCOL) {
      table.delete(sessionId);
      return undefined;
    }
    if (!recordIsLive(record) || !(await socketConnectable(record.socket))) {
      table.delete(sessionId);
      await removeClientRecord(paths.root, sessionId);
      return undefined;
    }
    return record;
  };

  const destroySession = async (sessionId: string): Promise<void> => {
    const drain = drains.get(sessionId);
    if (drain) {
      clearTimeout(drain);
      drains.delete(sessionId);
    }
    const record = table.get(sessionId);
    table.delete(sessionId);
    const holders = leases.get(sessionId);
    if (holders) {
      for (const socket of holders) {
        socket.destroy();
      }
      leases.delete(sessionId);
    }
    if (record && isPidAlive(record.pid)) {
      try {
        process.kill(record.pid, "SIGTERM");
      } catch {
        // ignore
      }
      const deadline = Date.now() + destroyMs;
      while (isPidAlive(record.pid) && Date.now() < deadline) {
        await sleep(50);
      }
      if (isPidAlive(record.pid)) {
        try {
          process.kill(record.pid, "SIGKILL");
        } catch {
          // ignore
        }
        const killDeadline = Date.now() + 1_000;
        while (isPidAlive(record.pid) && Date.now() < killDeadline) {
          await sleep(40);
        }
      }
    }
    await removeClientRecord(paths.root, sessionId);
  };

  const scheduleDrain = (sessionId: string) => {
    const existing = drains.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      drains.delete(sessionId);
      const holders = leases.get(sessionId);
      if (holders && holders.size > 0) return;
      void destroySession(sessionId);
    }, drainMs);
    drains.set(sessionId, timer);
  };

  const addLease = (sessionId: string, socket: net.Socket): boolean => {
    if (!table.has(sessionId)) return false;
    const drain = drains.get(sessionId);
    if (drain) {
      clearTimeout(drain);
      drains.delete(sessionId);
    }
    let set = leases.get(sessionId);
    if (!set) {
      set = new Set();
      leases.set(sessionId, set);
    }
    set.add(socket);
    const drop = () => {
      set!.delete(socket);
      if (set!.size === 0) scheduleDrain(sessionId);
    };
    socket.on("close", drop);
    socket.on("error", drop);
    return true;
  };

  const createSession = async (body: {
    cwd: string;
    provider?: string;
    model?: string;
    autoApprove?: boolean;
    permissionMode?: PermissionMode;
    sessionId?: string;
    noTools?: boolean;
  }): Promise<{ sessionId: string; address: string }> => {
    const cwd = path.resolve(body.cwd);
    const sessionId = body.sessionId?.trim() || newSessionId();
    const existing = await verifyLive(sessionId);
    if (existing) return { sessionId, address: existing.socket };

    const child = spawnClient({
      root: paths.root,
      sessionId,
      cwd,
      provider: body.provider,
      model: body.model,
      permissionMode: permissionModeOf(body),
      autoApprove: body.autoApprove,
      noTools: body.noTools,
    });
    const pid = child.pid;
    const exited = new Promise<string>((resolve) => {
      child.once?.("exit", (code, signal) => {
        resolve(`client exited code=${code} signal=${signal}`);
      });
    });

    const appeared = (async () => {
      const deadline = Date.now() + createMs;
      while (Date.now() < deadline) {
        const record = await readClientRecord(paths.root, sessionId);
        if (
          record &&
          record.protocol === MIND_PROTOCOL &&
          (await socketConnectable(record.socket))
        ) {
          table.set(sessionId, record);
          child.unref?.();
          return record;
        }
        await sleep(40);
      }
      return null;
    })();

    const winner = await Promise.race([
      appeared,
      exited.then((msg) => {
        throw new Error(msg);
      }),
    ]);
    if (!winner) {
      if (pid && isPidAlive(pid)) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // ignore
        }
      }
      await removeClientRecord(paths.root, sessionId);
      throw new Error(`timed out waiting for client ${sessionId} to register`);
    }
    return { sessionId, address: winner.socket };
  };

  const listWorkspace = async (cwd: string): Promise<MindListResult> => {
    const resolved = path.resolve(cwd);
    const live: LiveClientInfo[] = [];
    for (const sessionId of [...table.keys()]) {
      const record = await verifyLive(sessionId);
      if (record && path.resolve(record.cwd) === resolved) {
        live.push(liveInfo(record));
      }
    }
    const store = createFsStore(workspaceSessionDir(resolved));
    const history = await store.list();
    return { live, history };
  };

  const handle = async (body: MindRequestBody): Promise<MindResponse> => {
    const id = "";
    try {
      if (body.op === "create") {
        const created = await createSession(body);
        return { id, ok: true, op: "create", sessionId: created.sessionId, address: created.address };
      }
      if (body.op === "lookup") {
        const record = await verifyLive(body.sessionId);
        if (!record) return { id, ok: true, op: "lookup-miss", sessionId: body.sessionId };
        return { id, ok: true, op: "lookup", sessionId: body.sessionId, address: record.socket };
      }
      if (body.op === "destroy") {
        await destroySession(body.sessionId);
        return { id, ok: true, op: "destroy", sessionId: body.sessionId };
      }
      if (body.op === "list") {
        const result = await listWorkspace(body.cwd);
        return { id, ok: true, op: "list", result };
      }
      if (body.op === "lease") {
        return { id, ok: false, error: "lease requires a held connection" };
      }
      if (body.op === "stop") {
        return { id, ok: true, op: "stop" };
      }
      return { id, ok: false, error: "unknown op" };
    } catch (err) {
      return { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  const hello = (): MindHello => ({
    type: "hello",
    protocol: MIND_PROTOCOL,
    buildVersion: mindBuildVersion(),
    pid: process.pid,
  });

  const server = net.createServer((socket) => {
    writeNdjson(socket, hello());
    attachNdjson(socket, (value) => {
      const msg = value as Partial<MindRequest>;
      if (!msg || typeof msg.id !== "string" || !msg.body || typeof msg.body !== "object") {
        return;
      }
      const body = msg.body;
      if (body.op === "lease") {
        const ok = addLease(body.sessionId, socket);
        writeNdjson(
          socket,
          ok
            ? ({ id: msg.id, ok: true, op: "lease", sessionId: body.sessionId } satisfies MindResponse)
            : ({ id: msg.id, ok: false, error: `no live client ${body.sessionId}` } satisfies MindResponse),
        );
        return;
      }
      void handle(body).then((res) => {
        writeNdjson(socket, { ...res, id: msg.id });
        if (body.op === "stop" && res.ok) {
          socket.end();
          void close();
        }
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(paths.sock, () => {
      server.off("error", reject);
      resolve();
    });
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const timer of drains.values()) clearTimeout(timer);
    drains.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await releaseMindLock(lock, paths.root);
    // SIGTERM/stop must not signal client processes.
  };

  if (opts.installSignals) {
    const onStop = () => {
      void close().then(() => process.exit(0));
    };
    process.once("SIGTERM", onStop);
    process.once("SIGINT", onStop);
  }

  return {
    get root() {
      return paths.root;
    },
    close,
  };
}
