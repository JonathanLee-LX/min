import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  chooseModel,
  connectionEvents,
  disposeClient,
  getClient,
  listModelRows,
  listSessionRows,
  openSessionById,
  readSessionBlob,
  setEmitter,
  snapshot,
  startSession,
  submitText,
  type ChromeEvent,
  type ViewNotice,
} from "./host.js";
import { stageBytes } from "./staging.js";
import { loadEnvFiles } from "./load-env.js";
import type { ClientEvent } from "@min-agent/client";

/**
 * B/S process model:
 * - Browser is isolated (no MinClient, no API keys).
 * - This Node process holds MinClient + serves HTTP/SSE (+ static UI in prod).
 */

loadEnvFiles();

const PORT = Number(process.env.MIN_WEB_PORT ?? 43127);
const HOST = process.env.MIN_WEB_HOST ?? "127.0.0.1";
const CWD = process.env.MIN_CWD ?? process.env.INIT_CWD ?? process.cwd();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "web");

const sseClients = new Set<ServerResponse>();

setEmitter((event) => broadcast(event));

function broadcast(event: ClientEvent | ViewNotice | ChromeEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(payload);
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

function statusFor(body: { ok: boolean; route?: string }): number {
  if (body.ok && body.route === "send") return 202;
  if (!body.ok && body.route === "blocked") return 409;
  if (!body.ok && body.route === "empty") return 400;
  if (!body.ok) return 400;
  return 200;
}

async function serveStatic(res: ServerResponse, urlPath: string): Promise<boolean> {
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

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "local"}`);
  const { pathname } = url;
  const method = req.method ?? "GET";

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Filename");
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
      sendJson(res, 200, await snapshot());
      return;
    }

    if (method === "GET" && pathname === "/api/state") {
      const client = await getClient();
      sendJson(res, 200, {
        snapshot: await snapshot(),
        messages: client.getSession().messages,
      });
      return;
    }

    if (method === "GET" && pathname === "/api/sessions") {
      sendJson(res, 200, { sessions: await listSessionRows() });
      return;
    }

    if (method === "GET" && pathname === "/api/models") {
      const snap = await snapshot();
      sendJson(res, 200, { models: await listModelRows(), model: snap.model ?? null });
      return;
    }

    if (method === "GET" && pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": ok\n\n");
      const events = await connectionEvents();
      if (res.writableEnded) return;
      sseClients.add(res);
      for (const event of events) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      req.on("close", () => {
        sseClients.delete(res);
      });
      return;
    }

    if (method === "POST" && pathname === "/api/submit") {
      const body = (await readJson(req)) as {
        text?: string;
        attachmentIds?: string[];
      };
      const result = await submitText(body.text ?? "", body.attachmentIds ?? []);
      sendJson(res, statusFor(result), result);
      return;
    }

    if (method === "POST" && pathname === "/api/attachments") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bytes = new Uint8Array(Buffer.concat(chunks));
      const filename =
        typeof req.headers["x-filename"] === "string"
          ? path.basename(req.headers["x-filename"])
          : "upload";
      try {
        const staged = stageBytes({ filename, bytes });
        sendJson(res, 201, staged);
      } catch (err) {
        sendJson(res, 400, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (method === "GET" && pathname.startsWith("/api/blobs/")) {
      const blobId = pathname.slice("/api/blobs/".length);
      try {
        const blob = await readSessionBlob(blobId);
        res.writeHead(200, {
          "Content-Type": blob.mediaType,
          "Cache-Control": "private, max-age=3600",
        });
        res.end(Buffer.from(blob.bytes));
      } catch (err) {
        sendJson(res, 404, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (method === "POST" && pathname === "/api/send") {
      const body = (await readJson(req)) as { text?: string };
      const text = body.text?.trim() ?? "";
      if (!text) {
        sendJson(res, 400, { error: "text required" });
        return;
      }
      const client = await getClient();
      sendJson(res, 202, { ok: true });
      void client.send(text).catch((err) => {
        broadcast({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
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
      const client = await getClient();
      client.queue.push(text, body.mode ? { mode: body.mode } : undefined);
      sendJson(res, 200, { queueSize: client.queue.size });
      return;
    }

    if (method === "POST" && pathname === "/api/sessions/open") {
      const body = (await readJson(req)) as { id?: string };
      const id = body.id?.trim() ?? "";
      if (!id) {
        sendJson(res, 400, { error: "id required" });
        return;
      }
      const result = await openSessionById(id);
      sendJson(res, statusFor(result), result);
      return;
    }

    if (method === "POST" && pathname === "/api/sessions/new") {
      const result = await startSession();
      sendJson(res, statusFor(result), result);
      return;
    }

    if (method === "POST" && pathname === "/api/model") {
      const body = (await readJson(req)) as { key?: string; effort?: string };
      const key = body.key?.trim() ?? "";
      if (!key) {
        sendJson(res, 400, { error: "key required" });
        return;
      }
      const result = await chooseModel(key, body.effort);
      sendJson(res, statusFor(result), result);
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
      const client = await getClient();
      client.respondPermission(body.id, body.answer);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === "/api/abort") {
      const client = await getClient();
      client.abort();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && pathname === "/api/reset") {
      const result = await submitText("/reset");
      sendJson(res, statusFor(result), result);
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
  console.error(`cwd=${CWD}  (browser is isolated; MinClient lives in this process)`);
});

async function shutdown(): Promise<void> {
  for (const res of sseClients) res.end();
  sseClients.clear();
  await disposeClient();
  server.close();
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
