import type {
  ClientEvent,
  ClientEventHandler,
  ClientHandshake,
  ClientSessionInfo,
  ClientStatusSnapshot,
  MinClient,
  PermissionAnswer,
  SendOptions,
} from "@min-agent/client";
import type { InputQueueMode, SessionMeta } from "@min-agent/session";
import net from "node:net";
import { attachNdjson, writeNdjson } from "./ipc.js";
import type { ClientProcessServerMessage } from "./protocol.js";

export interface RemoteClient extends MinClient {
  readonly handshake: ClientHandshake;
  readonly address: string;
}

export async function connectClientProcess(address: string): Promise<RemoteClient> {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const conn = net.connect(address);
    conn.once("connect", () => resolve(conn));
    conn.once("error", reject);
  });

  const listeners = new Set<ClientEventHandler>();
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  let seq = 0;
  let handshake!: ClientHandshake;
  let cachedStatus: ClientStatusSnapshot;
  let cachedSession: ClientSessionInfo;
  let cachedQueue: string[] = [];
  let sawSnapshot = false;

  const handshakeWait = new Promise<ClientHandshake>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for client snapshot")), 8_000);
    attachNdjson(socket, (value) => {
      const msg = value as ClientProcessServerMessage;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "snapshot") {
        handshake = msg.snapshot;
        cachedStatus = msg.snapshot.status;
        cachedSession = msg.snapshot.session;
        cachedQueue = [...msg.snapshot.queue];
        sawSnapshot = true;
        clearTimeout(timer);
        resolve(msg.snapshot);
        return;
      }
      if (msg.type === "event") {
        applyEvent(msg.event);
        for (const handler of listeners) {
          try {
            handler(msg.event);
          } catch {
            // UI handlers must not break the stream.
          }
        }
        return;
      }
      if (msg.type === "res") {
        const waiter = pending.get(msg.id);
        if (!waiter) return;
        pending.delete(msg.id);
        if (msg.ok) waiter.resolve(msg.result);
        else waiter.reject(new Error(msg.error));
      }
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  function applyEvent(event: ClientEvent): void {
    if (event.type === "status") {
      cachedStatus = { ...cachedStatus, status: event.status, busy: event.status !== "idle" };
    } else if (event.type === "queued") {
      cachedStatus = { ...cachedStatus, queueSize: event.queueSize };
    } else if (event.type === "session") {
      cachedSession = {
        id: event.id,
        title: event.title,
        messageCount: event.messageCount,
        messages: event.messages ?? cachedSession.messages,
      };
      cachedStatus = { ...cachedStatus, sessionId: event.id };
    } else if (event.type === "context") {
      cachedStatus = { ...cachedStatus, context: event.usage };
    }
  }

  await handshakeWait;
  if (!sawSnapshot) throw new Error("client process sent no snapshot");

  const rpc = (req: { op: string } & Record<string, unknown>) => {
    const id = `r${++seq}`;
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      writeNdjson(socket, { ...req, id });
    });
  };

  const remote: RemoteClient = {
    handshake,
    address,
    queue: {
      get size() {
        return cachedStatus.queueSize;
      },
      push(text: string, opts?: { mode?: InputQueueMode }) {
        void rpc({ op: "queue", text, mode: opts?.mode }).then((result) => {
          const res = result as { queueSize?: number };
          if (typeof res?.queueSize === "number") {
            cachedStatus = { ...cachedStatus, queueSize: res.queueSize };
          }
        });
      },
      peek() {
        return cachedQueue;
      },
      clear() {
        cachedQueue = [];
        cachedStatus = { ...cachedStatus, queueSize: 0 };
        void rpc({ op: "queueClear" });
      },
    },
    async send(text: string, _opts?: SendOptions) {
      await rpc({ op: "send", text });
    },
    abort() {
      void rpc({ op: "abort" });
    },
    async dispose() {
      for (const waiter of pending.values()) waiter.reject(new Error("disconnected"));
      pending.clear();
      listeners.clear();
      socket.end();
    },
    getStatus() {
      return cachedStatus;
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    respondPermission(id: string, answer: PermissionAnswer) {
      void rpc({ op: "permission", permId: id, answer });
    },
    reset() {
      void rpc({ op: "reset" }).then((result) => {
        cachedSession = result as ClientSessionInfo;
      });
    },
    getSession() {
      return cachedSession;
    },
    async listSessions() {
      return (await rpc({ op: "listSessions" })) as SessionMeta[];
    },
    async compact(opts = {}) {
      const result = (await rpc({
        op: "compact",
        keepRecentTurns: opts.keepRecentTurns,
      })) as Awaited<ReturnType<MinClient["compact"]>>;
      return result;
    },
    advanced: {
      get runtime(): never {
        throw new Error("advanced.runtime is not available on a client process connection");
      },
    },
  };

  return remote;
}
