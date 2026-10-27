import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";
import type { ContextUsage } from "@min-agent/client";

const execFileAsync = promisify(execFile);

/**
 * Bottom status chrome:
 *   line 1 — working directory (+ git branch when present)
 *   line 2 — model (thinking intensity)  context%
 */

export function shortenPath(cwd: string, home = homedir()): string {
  const path = cwd.trim() || ".";
  if (home && (path === home || path.startsWith(`${home}/`))) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

/** Model id from a provider id like `deepseek:deepseek-flash`. */
export function modelDisplayName(providerId: string): string {
  const id = providerId.trim();
  if (!id) return "";
  const colon = id.indexOf(":");
  if (colon > 0 && colon < id.length - 1) return id.slice(colon + 1);
  return id;
}

/**
 * Thinking / reasoning intensity label when known.
 * DeepSeek Responses defaults to high; honor MIN_REASONING_EFFORT when set.
 */
export function thinkingIntensityLabel(providerId: string): string | undefined {
  const fromEnv = process.env.MIN_REASONING_EFFORT?.trim().toLowerCase();
  if (fromEnv) return fromEnv;
  const id = providerId.trim().toLowerCase();
  // DeepSeek Responses defaults to high effort; plain chat models do not.
  if (id.startsWith("deepseek:") && !id.includes("deepseek-chat")) return "high";
  return undefined;
}

export function contextPercentLabel(usage: ContextUsage | undefined): string {
  if (!usage) return "—";
  return `${Math.max(0, Math.min(100, Math.round(usage.ratio * 100)))}%`;
}

export function workspaceStatusLine(cwd: string, branch?: string | null): string {
  const dir = shortenPath(cwd);
  const b = branch?.trim();
  return b ? `${dir}  ${b}` : dir;
}

export function modelStatusLine(
  providerId: string,
  usage: ContextUsage | undefined,
  thinking = thinkingIntensityLabel(providerId),
): string {
  const model = modelDisplayName(providerId) || providerId.trim() || "model";
  const head = thinking ? `${model} (${thinking})` : model;
  return `${head}  ${contextPercentLabel(usage)}`;
}

/** Two status lines for the footer. */
export function bottomStatusLines(
  cwd: string,
  providerId: string,
  usage: ContextUsage | undefined,
  branch?: string | null,
): string[] {
  return [workspaceStatusLine(cwd, branch), modelStatusLine(providerId, usage)];
}

/** Read the current branch for a git working tree; undefined when not a repo. */
export async function readGitBranch(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "branch", "--show-current"],
      { encoding: "utf8", timeout: 1500, windowsHide: true },
    );
    const branch = stdout.trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}
