import { homedir } from "node:os";
import path from "node:path";

export interface MindPaths {
  root: string;
  pid: string;
  sock: string;
  sessions: string;
}

export function mindRoot(override?: string): string {
  if (override) return path.resolve(override);
  if (process.env.MIND_HOME?.trim()) return path.resolve(process.env.MIND_HOME.trim());
  if (process.env.MIN_HOME?.trim()) {
    return path.join(path.resolve(process.env.MIN_HOME.trim()), "mind");
  }
  return path.join(homedir(), ".min", "mind");
}

export function mindPaths(root?: string): MindPaths {
  const resolved = mindRoot(root);
  return {
    root: resolved,
    pid: path.join(resolved, "mind.pid"),
    sock: path.join(resolved, "mind.sock"),
    sessions: path.join(resolved, "sessions"),
  };
}

export function sessionDir(root: string, sessionId: string): string {
  return path.join(mindPaths(root).sessions, sessionId);
}

export function clientSocketPath(root: string, sessionId: string): string {
  return path.join(sessionDir(root, sessionId), "client.sock");
}

export function workspaceSessionDir(cwd: string): string {
  return path.join(path.resolve(cwd), ".min", "sessions");
}

export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const DRAIN_GRACE_MS_DEFAULT = 5_000;
export const DESTROY_WAIT_MS_DEFAULT = 10_000;
export const CREATE_TIMEOUT_MS_DEFAULT = 20_000;

export function drainGraceMs(): number {
  return envNumber("MIND_DRAIN_GRACE_MS", DRAIN_GRACE_MS_DEFAULT);
}

export function destroyWaitMs(): number {
  return envNumber("MIND_DESTROY_TIMEOUT_MS", DESTROY_WAIT_MS_DEFAULT);
}

export function createTimeoutMs(): number {
  return envNumber("MIND_CREATE_TIMEOUT_MS", CREATE_TIMEOUT_MS_DEFAULT);
}
