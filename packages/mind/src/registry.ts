import { readdir, readFile, rm, unlink } from "node:fs/promises";
import { connect } from "node:net";
import path from "node:path";
import { sessionRegistryDir, workspaceSessionDir } from "./paths.js";
import { PROTOCOL } from "./protocol.js";

export interface SessionRecord {
  pid: number;
  socketPath: string;
  protocol: number;
  cwd: string;
  buildVersion: string;
}

export interface SessionAddress extends SessionRecord {
  sessionId: string;
}

export interface HistoryMeta {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function canConnect(socketPath: string, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    setTimeout(() => finish(false), timeoutMs);
  });
}

async function canConnectRetry(socketPath: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await canConnect(socketPath)) return true;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

export async function readRecord(
  home: string,
  sessionId: string,
): Promise<SessionRecord | null> {
  try {
    const raw = await readFile(
      path.join(sessionRegistryDir(home, sessionId), "record.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<SessionRecord>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.socketPath !== "string" ||
      typeof parsed.protocol !== "number" ||
      typeof parsed.cwd !== "string" ||
      typeof parsed.buildVersion !== "string"
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      socketPath: parsed.socketPath,
      protocol: parsed.protocol,
      cwd: parsed.cwd,
      buildVersion: parsed.buildVersion,
    };
  } catch {
    return null;
  }
}

export async function removeRecord(
  home: string,
  sessionId: string,
  socketPath?: string,
): Promise<void> {
  await rm(sessionRegistryDir(home, sessionId), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
  if (socketPath) await unlink(socketPath).catch(() => undefined);
}

/**
 * Claim a live, same-protocol client. Drop stale files.
 * A different protocol is left running and is not claimed.
 */
export async function inspectSession(
  home: string,
  sessionId: string,
): Promise<
  | { kind: "claimed"; address: SessionAddress }
  | { kind: "foreign" }
  | { kind: "absent" }
> {
  const record = await readRecord(home, sessionId);
  if (!record) return { kind: "absent" };
  const alive = pidAlive(record.pid);
  if (!alive) {
    await removeRecord(home, sessionId, record.socketPath);
    return { kind: "absent" };
  }
  const up = await canConnectRetry(record.socketPath);
  if (!up) {
    // Socket is gone. Drop the registry. A different protocol is not signaled.
    // Same protocol is wedged — stop it so create does not start a second writer.
    if (record.protocol === PROTOCOL) {
      try {
        process.kill(record.pid, "SIGTERM");
      } catch {
        // Already exited.
      }
    }
    await removeRecord(home, sessionId, record.socketPath);
    return { kind: "absent" };
  }
  if (record.protocol !== PROTOCOL) return { kind: "foreign" };
  return { kind: "claimed", address: { sessionId, ...record } };
}

export async function listSessionIds(home: string): Promise<string[]> {
  try {
    const names = await readdir(path.join(home, "sessions"));
    return names.filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

export async function readHistory(cwd: string): Promise<HistoryMeta[]> {
  const dir = workspaceSessionDir(cwd);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const metas: HistoryMeta[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(path.join(dir, name), "utf8");
      const parsed = JSON.parse(raw) as { meta?: Partial<HistoryMeta> };
      const meta = parsed.meta;
      if (!meta?.id || !meta.createdAt || !meta.updatedAt) continue;
      metas.push({
        id: meta.id,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      });
    } catch {
      // Skip a torn or foreign file.
    }
  }
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
