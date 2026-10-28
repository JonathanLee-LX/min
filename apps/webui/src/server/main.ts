import {
  clientProcessPath,
  connectRemote,
  type ClientEvent,
  type RemoteSession,
} from "@min-agent/client";
import { ensureMind, type Mind, type MindLease } from "@min-agent/mind";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./load-env.js";

/**
 * B/S process model:
 * - Browser is isolated (no MinClient, no API keys).
 * - This process is a lease plus an HTTP/SSE bridge onto the session socket.
 * - The session itself runs in a client process supervised by mind.
 */

loadEnvFiles();

const PORT = Number(process.env.MIN_WEB_PORT ?? 43127);
const HOST = process.env.MIN_WEB_HOST ?? "127.0.0.1";
const CWD = process.env.MIN_CWD ?? process.env.INIT_CWD ?? process.cwd();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "web");

const sseClients = new Set<ServerResponse>();

let mindPromise: Promise<Mind> | undefined;
let sessionId: string | undefined;
let addressGate: Promise<void> = Promise.resolve();

function mind(): Promise<Mind> {
  if (!mindPromise) {
    mindPromise = ensureMind({ clientEntry: clientProcessPath() });
  }
  return mindPromise;
}

function launch() {
  const auto = process.env.MIN_AUTO === "1";
  const yes = process.env.MIN_YES === "1" || auto;
  return {
    cwd: CWD,
    provider: process.env.PROVIDER,
    model: process.env.MODEL,
    autoApprove: yes,
    approveMode: auto ? ("auto" as const) : yes ? ("yes" as const) : undefined,
    allowRootGrant: auto,
    persistPermissionGrants: !auto,
    noTools: process.env.MIN_NO_TOOLS === "1",
    allowBash: yes,
    sessionId,
  };
}

async function sessionAddress(): Promise<{ sessionId: string; socketPath: string }> {
  const run = addressGate.then(async () => {
    const current = await mind();
    const address = await current.create(launch());
    sessionId = address.sessionId;
    return address;
  });
  addressGate = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

interface Attachment {
  remote: RemoteSession;
  lease: MindLease;
  close(): void;
}

async function attach(): Promise<Attachment> {
  const current = await mind();
  const address = await sessionAddress();
  const lease = await current.lease(address.sessionId);
  try {
    const remote = await connectRemote(address.socketPath);
    return {
      remote,
      lease,
      close() {
        remote.close();
        lease.close();
      },
    };
  } catch (err) {
    lease.close();
    throw err;
  }
}

function writeEvent(res: ServerResponse, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

async function serveStatic(
  res: ServerResponse,
  urlPath: string,
): Promise<boolean> {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.normalize(path.join(webRoot, rel));
  if (!file.startsWith(webRoot)) {
    sendJson(res, 403, { error: "forbidden" });
    return true;
  }
  try {
    const data = await readFile(file);
    const ext = path.extname(file);
    const type =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : ext === ".css"
            ? "text/css; charset=utf-8"
            : ext === ".svg"
              ? "image/svg+xml"
              : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
    return true;
  } catch {
    if (rel !== "/index.html") {
      try {
        const data = await readFile(path.join(webRoot, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(data);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "local"}`);
  const { pathname } = url;
  const method = req.method ?? "GET";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET" && pathname === "/api/status") {
      const attachment = await attach();
      try {
        sendJson(res, 200, attachment.remote.getStatus());
      } finally {
        attachment.close();
      }
      return;
    }

    if (method === "GET" && pathname === "/events") {
      const attachment = await attach();
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": ok\n\n");
      sseClients.add(res);
      writeEvent(res, { type: "handoff", ...attachment.remote.handoff });
      const unsub = attachment.remote.subscribe((event: ClientEvent) => {
        writeEvent(res, event);
      });
      req.on("close", () => {
        sseClients.delete(res);
        unsub();
        attachment.close();
      });
      return;
    }

    if (method === "POST" && pathname === "/api/send") {
      const body = (await readJson(req)) as { text?: string };
      const text = body.text?.trim() ?? "";
      if (!text) {
        sendJson(res, 400, { error: "text required" });
        return;
      }
      const attachment = await attach();
      sendJson(res, 202, { ok: true });
      void attachment.remote.send(text).finally(() => attachment.close());
      return;
    }

    if (method === "POST" && pathname === "/api/queue") {
      const body = (await readJson(req)) as {
        text?: string;
        mode?: "enqueue" | "dense-latest" | "dense-concat";
      };
      const text = body.text?.trim() ?? "";
      if (!text) {
        sendJson(res, 400, { error: "text required" });
        return;
      }
      const attachment = await attach();
      try {
        const queueSize = await attachment.remote.queue.push(
          text,
          body.mode ? { mode: body.mode } : undefined,
        );
        sendJson(res, 200, { queueSize });
      } finally {
        attachment.close();
      }
      return;
    }

    if (method === "POST" && pathname === "/api/permission") {
      const body = (await readJson(req)) as {
        id?: string;
        answer?: "allow" | "deny" | "allow_session";
      };
      if (!body.id || !body.answer) {
        sendJson(res, 400, { error: "id and answer required" });
        return;
      }
      const attachment = await attach();
      try {
        attachment.remote.respondPermission(body.id, body.answer);
        sendJson(res, 200, { ok: true });
      } finally {
        attachment.close();
      }
      return;
    }

    if (method === "POST" && pathname === "/api/abort") {
      const attachment = await attach();
      try {
        attachment.remote.abort();
        sendJson(res, 200, { ok: true });
      } finally {
        attachment.close();
      }
      return;
    }

    if (method === "POST" && pathname === "/api/reset") {
      const attachment = await attach();
      try {
        attachment.remote.reset();
        sendJson(res, 200, attachment.remote.getSession());
      } finally {
        attachment.close();
      }
      return;
    }

    if (method === "GET") {
      const served = await serveStatic(res, pathname);
      if (served) return;
      sendJson(res, 404, {
        error: "not found",
        hint: "Run pnpm --filter=@min-agent/webui build, or use vite dev proxy",
      });
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const server = createServer((req, res) => {
  void handler(req, res);
});

server.listen(PORT, HOST, () => {
  console.error(`min-web listening on http://${HOST}:${PORT}`);
  console.error(`cwd=${CWD}  (browser is isolated; sessions run behind mind)`);
});

async function shutdown(): Promise<void> {
  for (const res of sseClients) res.end();
  sseClients.clear();
  if (mindPromise) {
    const current = await mindPromise;
    current.close();
  }
  server.close();
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
