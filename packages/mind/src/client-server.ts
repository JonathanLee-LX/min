import {
  clientHandshake,
  shutdownClient,
  type MinClient,
} from "@min-agent/client";
import { mkdir, rm } from "node:fs/promises";
import net from "node:net";
import { attachNdjson, writeNdjson } from "./ipc.js";
import { clientSocketPath, sessionDir } from "./paths.js";
import type { ClientProcessRequest, ClientProcessServerMessage, ClientRecord } from "./protocol.js";
import { removeClientRecord, writeClientRecord } from "./registry.js";
import { MIND_PROTOCOL, mindBuildVersion } from "./version.js";

export interface ClientProcessServer {
  readonly socketPath: string;
  readonly sessionId: string;
  shutdown(): Promise<void>;
}

export async function listenClientProcess(opts: {
  client: MinClient;
  root: string;
  sessionId: string;
  cwd: string;
  provider?: string;
  autoApprove?: boolean;
}): Promise<ClientProcessServer> {
  const socketPath = clientSocketPath(opts.root, opts.sessionId);
  await mkdir(sessionDir(opts.root, opts.sessionId), { recursive: true });
  try {
    await rm(socketPath, { force: true });
  } catch {
    // ignore
  }

  let accepting = true;
  const sockets = new Set<net.Socket>();
  const { client } = opts;

  const handleRequest = async (req: ClientProcessRequest): Promise<unknown> => {
    if (!accepting) throw new Error("shutting down");
    switch (req.op) {
      case "send":
        await client.send(req.text);
        return { ok: true };
      case "abort":
        client.abort();
        return { ok: true };
      case "permission":
        client.respondPermission(req.permId, req.answer);
        return { ok: true };
      case "queue":
        client.queue.push(req.text, req.mode ? { mode: req.mode } : undefined);
        return { queueSize: client.queue.size };
      case "queuePeek":
        return { items: client.queue.peek() };
      case "queueClear":
        client.queue.clear();
        return { ok: true };
      case "getStatus":
        return client.getStatus();
      case "getSession":
        return client.getSession();
      case "compact":
        return client.compact({ keepRecentTurns: req.keepRecentTurns });
      case "reset":
        client.reset();
        return client.getSession();
      case "listSessions":
        return client.listSessions();
      default:
        throw new Error("unknown op");
    }
  };

  const server = net.createServer((socket) => {
    if (!accepting) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));

    let live = false;
    const unsub = client.subscribe((event) => {
      if (live) writeNdjson(socket, { type: "event", event } satisfies ClientProcessServerMessage);
    });
    const snapshot = clientHandshake(client);
    writeNdjson(socket, { type: "snapshot", snapshot } satisfies ClientProcessServerMessage);
    live = true;

    attachNdjson(socket, (value) => {
      const req = value as Partial<ClientProcessRequest>;
      if (!req || typeof req.id !== "string" || typeof req.op !== "string") return;
      void handleRequest(req as ClientProcessRequest)
        .then((result) => {
          writeNdjson(socket, {
            type: "res",
            id: req.id!,
            ok: true,
            result,
          } satisfies ClientProcessServerMessage);
        })
        .catch((err: unknown) => {
          writeNdjson(socket, {
            type: "res",
            id: req.id!,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          } satisfies ClientProcessServerMessage);
        });
    });
    socket.on("close", () => unsub());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const record: ClientRecord = {
    sessionId: opts.sessionId,
    pid: process.pid,
    socket: socketPath,
    protocol: MIND_PROTOCOL,
    cwd: opts.cwd,
    buildVersion: mindBuildVersion(),
    provider: opts.provider,
    autoApprove: Boolean(opts.autoApprove),
  };
  await writeClientRecord(opts.root, record);

  let closed = false;
  const shutdown = async () => {
    if (closed) return;
    closed = true;
    accepting = false;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    try {
      await shutdownClient(client);
    } catch {
      // still remove the registration
    }
    await removeClientRecord(opts.root, opts.sessionId);
    try {
      await rm(socketPath, { force: true });
    } catch {
      // ignore
    }
  };

  return { socketPath, sessionId: opts.sessionId, shutdown };
}
