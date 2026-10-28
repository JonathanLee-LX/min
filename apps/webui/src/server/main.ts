import type { ClientEvent, ClientHandshake } from "@min-agent/client";
import { attachSession, type AttachedSession } from "@min-agent/mind";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./load-env.js";

/**
 * B/S process model:
 * - Browser is isolated (no MinClient, no API keys).
 * - This Node process is a lease + HTTP/SSE bridge to a client process.
 * - mind owns create/lookup/destroy; events and send go to the client socket.
 */

loadEnvFiles();

const PORT = Number(process.env.MIN_WEB_PORT ?? 43127);
const HOST = process.env.MIN_WEB_HOST ?? "127.0.0.1";
const CWD = process.env.MIN_CWD ?? process.env.INIT_CWD ?? process.cwd();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "web");

let sessionId = process.env.MIN_SESSION?.trim() || undefined;

function permissionMode() {
  if (process.env.MIN_AUTO === "1") return "auto" as const;
  if (process.env.MIN_YES === "1") return "yes" as const;
  return "ask" as const;
}

function attachOpts() {
  return {
    cwd: CWD,
    provider: process.env.PROVIDER,
    model: process.env.MODEL,
    sessionId,
    permissionMode: permissionMode(),
    autoApprove: process.env.MIN_AUTO === "1" || process.env.MIN_YES === "1",
    noTools: process.env.MIN_NO_TOOLS === "1",
  };
}

async function attachCurrent(): Promise<AttachedSession> {
  const attached = await attachSession(attachOpts());
  sessionId = attached.sessionId;
  return attached;
}

async function withClient<T>(fn: (client: AttachedSession["client"]) => Promise<T>): Promise<T> {
  const attached = await attachCurrent();
  try {
    return await fn(attached.client);
  } finally {
    await attached.release();
  }
}

function writeSse(res: ServerResponse, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function replayHandshake(res: ServerResponse, handshake: ClientHandshake): void {
  writeSse(res, {
    type: "session",
    id: handshake.session.id,
    title: handshake.session.title,
    messageCount: handshake.session.messageCount,
    reason: "open",
    messages: handshake.session.messages,
  });
  writeSse(res, { type: "status", status: handshake.status.status });
  if (handshake.turn.thinking) {
    writeSse(res, { type: "thinking_delta", text: handshake.turn.thinking });
  }
  if (handshake.turn.text) {
    writeSse(res, { type: "assistant_delta", text: handshake.turn.text });
  }
  for (const pending of handshake.pendingPermissions) {
    writeSse(res, {
      type: "permission",
      id: pending.id,
      reason: pending.reason,
      toolCall: pending.toolCall,
      grantRoot: pending.grantRoot,
    });
  }
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
      const status = await withClient((client) => Promise.resolve(client.getStatus()));
      sendJson(res, 200, status);
      return;
    }

    if (method === "GET" && pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": ok\n\n");
      const attached = await attachCurrent();
      replayHandshake(res, attached.handshake);
      const unsub = attached.client.subscribe((event: ClientEvent) => {
        writeSse(res, event);
      });
      req.on("close", () => {
        unsub();
        void attached.release();
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
      sendJson(res, 202, { ok: true });
      void withClient(async (client) => {
        try {
          await client.send(text);
        } catch (err) {
          // SSE subscribers see ClientEvent error from the process.
          void err;
        }
      });
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
      const queueSize = await withClient(async (client) => {
        client.queue.push(text, body.mode ? { mode: body.mode } : undefined);
        return client.queue.size;
      });
      sendJson(res, 200, { queueSize });
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
      await withClient(async (client) => {
        client.respondPermission(body.id!, body.answer!);
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === "/api/abort") {
      await withClient(async (client) => {
        client.abort();
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === "/api/reset") {
      await withClient(async (client) => {
        client.reset();
      });
      sendJson(res, 200, { ok: true });
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
  console.error(`cwd=${CWD}  (browser is isolated; client process is behind mind)`);
});

async function shutdown(): Promise<void> {
  server.close();
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
