import { connect, type Socket } from "node:net";
import type { InputQueueMode } from "@min-agent/session";
import { readNdjson, writeNdjson } from "./ndjson.js";
import { CLIENT_PROTOCOL } from "./protocol.js";
import type {
  ClientEvent,
  ClientEventHandler,
  ClientSessionInfo,
  ClientStatusSnapshot,
  PermissionAnswer,
  SessionHandoff,
} from "./types.js";

export interface RemoteCompactResult {
  summary: string;
  droppedMessageCount: number;
  keptTurns: number;
  messageCount: number;
}

/**
 * Frontend connection to a session process.
 * `advanced.runtime` is not on this surface — it stays inside the process.
 */
export interface RemoteSession {
  readonly handoff: SessionHandoff;
  readonly protocol: number;
  readonly buildVersion: string;
  send(text: string): Promise<void>;
  abort(): void;
  subscribe(handler: ClientEventHandler): () => void;
  respondPermission(id: string, answer: PermissionAnswer): void;
  queue: {
    push(text: string, opts?: { mode?: InputQueueMode }): Promise<number>;
    peek(): readonly string[];
    clear(): void;
    readonly size: number;
  };
  reset(): void;
  getStatus(): ClientStatusSnapshot;
  getSession(): ClientSessionInfo;
  compact(opts?: { keepRecentTurns?: number }): Promise<RemoteCompactResult>;
  /** Drop this connection. Does not stop the session process. */
  close(): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export function connectRemote(socketPath: string): Promise<RemoteSession> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.once("error", fail);

    let protocol = 0;
    let buildVersion = "";
    let handoff: SessionHandoff | undefined;
    const buffer: ClientEvent[] = [];
    const listeners = new Set<ClientEventHandler>();
    const pending = new Map<string, Pending>();
    let seq = 0;
    let status: ClientStatusSnapshot | undefined;
    let session: ClientSessionInfo | undefined;
    let queueTexts: string[] = [];
    let queueSize = 0;
    let settled = false;

    const emit = (event: ClientEvent) => {
      apply(event);
      if (listeners.size === 0) {
        buffer.push(event);
        return;
      }
      for (const handler of listeners) {
        try {
          handler(event);
        } catch {
          // UI handlers must not break the socket reader.
        }
      }
    };

    const apply = (event: ClientEvent) => {
      if (event.type === "status" && status) {
        status = { ...status, status: event.status, busy: event.status !== "idle" };
      } else if (event.type === "queued") {
        queueSize = event.queueSize;
        if (status) status = { ...status, queueSize };
        if (event.text) queueTexts = [...queueTexts, event.text];
        if (queueTexts.length !== queueSize) {
          void request<{ texts: string[] }>({ op: "queuePeek" }).then((result) => {
            queueTexts = [...result.texts];
            queueSize = queueTexts.length;
          }).catch(() => undefined);
        }
      } else if (event.type === "follow_up") {
        void request<{ texts: string[] }>({ op: "queuePeek" }).then((result) => {
          queueTexts = [...result.texts];
          queueSize = queueTexts.length;
          if (status) status = { ...status, queueSize };
        }).catch(() => undefined);
      } else if (event.type === "session" && session) {
        session = {
          id: event.id,
          title: event.title ?? session.title,
          messageCount: event.messageCount,
          messages: event.messages ? [...event.messages] : session.messages,
        };
        if (status) status = { ...status, sessionId: event.id };
      } else if (event.type === "context" && status) {
        status = { ...status, context: event.usage };
      }
    };

    const request = <T>(body: Record<string, unknown>): Promise<T> => {
      const id = String(++seq);
      return new Promise<T>((res, rej) => {
        pending.set(id, {
          resolve: (value) => res(value as T),
          reject: rej,
        });
        writeNdjson(socket, { id, ...body });
      });
    };

    const rejectAll = (err: Error) => {
      for (const item of pending.values()) item.reject(err);
      pending.clear();
    };

    readNdjson(socket, (message) => {
      const frame = message as {
        type?: string;
        protocol?: number;
        buildVersion?: string;
        handoff?: SessionHandoff;
        event?: ClientEvent;
        id?: string;
        ok?: boolean;
        result?: unknown;
        error?: string;
      };
      if (!settled) {
        if (frame.type === "hello") {
          protocol = frame.protocol ?? 0;
          buildVersion = frame.buildVersion ?? "";
          if (protocol !== CLIENT_PROTOCOL) {
            fail(new Error(`client protocol ${protocol} != ${CLIENT_PROTOCOL}`));
          }
          return;
        }
        if (frame.type === "snapshot" && frame.handoff) {
          handoff = frame.handoff;
          status = { ...frame.handoff.status };
          queueSize = status.queueSize;
          session = {
            id: status.sessionId,
            title: frame.handoff.title,
            messageCount: frame.handoff.messages.length,
            messages: frame.handoff.messages,
          };
          settled = true;
          socket.off("error", fail);
          socket.on("error", () => {
            rejectAll(new Error("client socket closed"));
          });
          const remote = createRemote();
          void request<{ texts: string[] }>({ op: "queuePeek" })
            .then((result) => {
              queueTexts = [...result.texts];
              queueSize = queueTexts.length;
            })
            .catch(() => undefined)
            .finally(() => resolve(remote));
          return;
        }
        return;
      }
      if (frame.type === "event" && frame.event) {
        emit(frame.event);
        return;
      }
      if (frame.type === "response" && frame.id) {
        const item = pending.get(frame.id);
        if (!item) return;
        pending.delete(frame.id);
        if (frame.ok) item.resolve(frame.result);
        else item.reject(new Error(frame.error ?? "request failed"));
      }
    });

    socket.on("close", () => {
      if (!settled) fail(new Error(`cannot connect to client socket ${socketPath}`));
      else rejectAll(new Error("client socket closed"));
    });

    function createRemote(): RemoteSession {
      if (!handoff || !status || !session) {
        throw new Error("client handoff missing");
      }
      const initial = handoff;
      return {
        handoff: initial,
        get protocol() {
          return protocol;
        },
        get buildVersion() {
          return buildVersion;
        },
        send(text) {
          return request<void>({ op: "send", text });
        },
        abort() {
          void request({ op: "abort" }).catch(() => undefined);
        },
        subscribe(handler) {
          listeners.add(handler);
          if (buffer.length) {
            const pendingEvents = buffer.splice(0, buffer.length);
            for (const event of pendingEvents) {
              try {
                handler(event);
              } catch {
                // ignore
              }
            }
          }
          return () => {
            listeners.delete(handler);
          };
        },
        respondPermission(id, answer) {
          void request({ op: "permission", permissionId: id, answer }).catch(
            () => undefined,
          );
        },
        queue: {
          get size() {
            return queueSize;
          },
          push(text, opts) {
            return request<{ queueSize: number }>({
              op: "queue",
              text,
              mode: opts?.mode,
            }).then((result) => {
              queueSize = result.queueSize;
              return result.queueSize;
            });
          },
          peek() {
            return queueTexts;
          },
          clear() {
            queueTexts = [];
            queueSize = 0;
            void request({ op: "queueClear" }).catch(() => undefined);
          },
        },
        reset() {
          void request({ op: "reset" }).catch(() => undefined);
        },
        getStatus() {
          return status ?? initial.status;
        },
        getSession() {
          return (
            session ?? {
              id: initial.status.sessionId,
              title: initial.title,
              messageCount: initial.messages.length,
              messages: initial.messages,
            }
          );
        },
        compact(opts) {
          return request<RemoteCompactResult>({
            op: "compact",
            keepRecentTurns: opts?.keepRecentTurns,
          });
        },
        close() {
          socket.end();
          socket.destroy();
        },
      };
    }
  });
}
