import {
  createAutoPermissionApprover,
  createClient,
  type ClientEvent,
  type MinClient,
} from "@min/client";
import { loadProviderExtensions, resolveProvider } from "@min/runtime";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./load-env.js";

/**
 * B/S MVP process model:
 * - Browser is isolated (no MinClient, no API keys).
 * - This Node process holds MinClient + serves HTTP/SSE (+ static UI in prod).
 * - Future: optional worker/child process for Client crash isolation; same HTTP contract.
 */

loadEnvFiles();

const PORT = Number(process.env.MIN_WEB_PORT ?? 43127);
const HOST = process.env.MIN_WEB_HOST ?? "127.0.0.1";
const CWD = process.env.MIN_CWD ?? process.env.INIT_CWD ?? process.cwd();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "web");

let clientPromise: Promise<MinClient> | undefined;
const sseClients = new Set<ServerResponse>();

async function getClient(): Promise<MinClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      await loadProviderExtensions();
      const c = await createClient({
        cwd: CWD,
        provider: resolveProvider({
          provider: process.env.PROVIDER,
          model: process.env.MODEL,
        }),
        noTools: process.env.MIN_NO_TOOLS === "1",
        allowBash:
          process.env.MIN_AUTO === "1" || process.env.MIN_YES === "1",
        applyRootGrant: process.env.MIN_AUTO === "1",
        autoApprovePermission:
          process.env.MIN_AUTO === "1"
            ? createAutoPermissionApprover({ mode: "auto" })
            : process.env.MIN_YES === "1"
              ? createAutoPermissionApprover({ mode: "yes" })
              : undefined /* interactive via /api/permission */,
      });
      c.subscribe((event) => broadcast(event));
      return c;
    })();
  }
  return clientPromise;
}

function broadcast(event: ClientEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
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
      const client = await getClient();
      sendJson(res, 200, client.getStatus());
      return;
    }

    if (method === "GET" && pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": ok\n\n");
      sseClients.add(res);
      const status = (await getClient()).getStatus();
      res.write(
        `data: ${JSON.stringify({ type: "session", id: status.sessionId, messageCount: 0 })}\n\n`,
      );
      req.on("close", () => {
        sseClients.delete(res);
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
      const client = await getClient();
      // Respond immediately; progress goes over SSE.
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
      const client = await getClient();
      client.reset();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "GET") {
      const served = await serveStatic(res, pathname);
      if (served) return;
      sendJson(res, 404, {
        error: "not found",
        hint: "Run pnpm --filter=@min/webui build, or use vite dev proxy",
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
  if (clientPromise) {
    const c = await clientPromise;
    await c.dispose();
  }
  server.close();
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
