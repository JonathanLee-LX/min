import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SESSION_ID_RE = /^[\w.-]+$/;

export function mindHome(): string {
  const fromEnv = process.env.MIND_HOME?.trim();
  if (fromEnv) return fromEnv;
  return join(homedir(), ".min", "mind");
}

export function mindSocketPath(home: string): string {
  return join(home, "mind.sock");
}

export function mindPidPath(home: string): string {
  return join(home, "mind.pid");
}

export function mindLockDir(home: string): string {
  return join(home, "mind.lock");
}

export function sessionRegistryDir(home: string, sessionId: string): string {
  return join(home, "sessions", sessionId);
}

export function clientSocketPath(home: string, sessionId: string): string {
  const preferred = join(sessionRegistryDir(home, sessionId), "client.sock");
  if (Buffer.byteLength(preferred) <= 100) return preferred;
  return join(home, "s", `${sessionId}.sock`);
}

export function workspaceSessionDir(cwd: string): string {
  return join(cwd, ".min", "sessions");
}

export function mindDaemonPath(metaUrl = import.meta.url): string {
  const here = dirname(fileURLToPath(metaUrl));
  const source = join(here, "daemon.ts");
  if (existsSync(source)) return source;
  return join(here, "daemon.js");
}

export function readBuildVersion(metaUrl = import.meta.url): string {
  const here = dirname(fileURLToPath(metaUrl));
  for (const candidate of [
    join(here, "package.json"),
    join(here, "../package.json"),
    join(here, "../../package.json"),
  ]) {
    try {
      const raw = JSON.parse(readFileSync(candidate, "utf8")) as {
        version?: string;
      };
      if (typeof raw.version === "string" && raw.version.trim()) {
        return raw.version.trim();
      }
    } catch {
      // try the next candidate
    }
  }
  return "unknown";
}

export function newSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `ses_${ts}_${rand}`;
}
