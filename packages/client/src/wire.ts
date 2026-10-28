import { createServer, type Server, type Socket } from "node:net";
import { unlink } from "node:fs/promises";
import type { InputQueueMode } from "@min-agent/session";
import { getClientHost } from "./client.js";
import { readNdjson, writeNdjson } from "./ndjson.js";
import { CLIENT_PROTOCOL } from "./protocol.js";
import type { MinClient, PermissionAnswer } from "./types.js";

export interface ClientWireServer {
  close(): Promise<void>;
}

interface WireRequest {
  id?: string;
  op?: string;
  text?: string;
  mode?: InputQueueMode;
  permissionId?: string;
  answer?: PermissionAnswer;
  keepRecentTurns?: number;
}

/**
 * Serve one MinClient on a unix socket.
 * Each connection gets a handoff snapshot, then live ClientEvents.
 * Requests are applied to the shared client and the results are broadcast
 * through the normal event stream — the server does not remember which
 * frontend sent them.
 */
export async function serveClient(opts: {
  client: MinClient;
  socketPath: string;
  buildVersion: string;
}): Promise<ClientWireServer> {
  const host = getClientHost(opts.client);
  const sockets = new Set<Socket>();

  const broadcast = (value: unknown) => {
    for (const socket of sockets) {
      if (socket.writable) writeNdjson(socket, value);
    }
  };

  const unsubscribe = opts.client.subscribe((event) => {
    broadcast({ type: "event", event });
  });

  const respond = (
    socket: Socket,
    id: string | undefined,
    body: { ok: boolean; result?: unknown; error?: string },
  ) => {
    if (!id || !socket.writable) return;
    writeNdjson(socket, { type: "response", id, ...body });
  };

  const handle = (socket: Socket, raw: unknown) => {
    const req = raw as WireRequest;
    const id = typeof req?.id === "string" ? req.id : undefined;
    if (host.closing) {
      respond(socket, id, { ok: false, error: "closing" });
      return;
    }
    const op = req?.op;
    try {
      if (op === "send") {
        const text = req.text ?? "";
        void opts.client.send(text).then(
          () => respond(socket, id, { ok: true }),
          (err: unknown) =>
            respond(socket, id, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
        );
        return;
      }
      if (op === "abort") {
        opts.client.abort();
        respond(socket, id, { ok: true });
        return;
      }
      if (op === "permission") {
        if (req.permissionId && req.answer) {
          opts.client.respondPermission(req.permissionId, req.answer);
        }
        respond(socket, id, { ok: true });
        return;
      }
      if (op === "queue") {
        opts.client.queue.push(req.text ?? "", req.mode ? { mode: req.mode } : undefined);
        respond(socket, id, { ok: true, result: { queueSize: opts.client.queue.size } });
        return;
      }
      if (op === "queuePeek") {
        respond(socket, id, { ok: true, result: { texts: opts.client.queue.peek() } });
        return;
      }
      if (op === "queueClear") {
        opts.client.queue.clear();
        respond(socket, id, { ok: true });
        return;
      }
      if (op === "reset") {
        opts.client.reset();
        respond(socket, id, { ok: true, result: { sessionId: opts.client.getSession().id } });
        return;
      }
      if (op === "compact") {
        void opts.client
          .compact(
            req.keepRecentTurns !== undefined
              ? { keepRecentTurns: req.keepRecentTurns }
              : {},
          )
          .then(
            (result) => respond(socket, id, { ok: true, result }),
            (err: unknown) =>
              respond(socket, id, {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              }),
          );
        return;
      }
      if (op === "getStatus") {
        respond(socket, id, { ok: true, result: opts.client.getStatus() });
        return;
      }
      if (op === "getSession") {
        const session = opts.client.getSession();
        respond(socket, id, {
          ok: true,
          result: {
            id: session.id,
            title: session.title,
            messageCount: session.messageCount,
            messages: session.messages,
          },
        });
        return;
      }
      respond(socket, id, { ok: false, error: `unknown op ${String(op)}` });
    } catch (err) {
      respond(socket, id, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  await unlink(opts.socketPath).catch(() => undefined);

  const server: Server = createServer((socket) => {
    if (host.closing) {
      socket.end();
      return;
    }
    // Snapshot and subscribe are one synchronous handoff so no delta is lost.
    const snap = host.handoff();
    sockets.add(socket);
    writeNdjson(socket, {
      type: "hello",
      protocol: CLIENT_PROTOCOL,
      buildVersion: opts.buildVersion,
      sessionId: snap.status.sessionId,
    });
    writeNdjson(socket, { type: "snapshot", handoff: snap });

    readNdjson(socket, (message) => handle(socket, message));
    const drop = () => {
      sockets.delete(socket);
    };
    socket.on("close", drop);
    socket.on("error", drop);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    async close() {
      unsubscribe();
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await unlink(opts.socketPath).catch(() => undefined);
    },
  };
}
