import type { ToolCallPart } from "@min/core";
import type {
  PermissionContext,
  PermissionDecision,
  PermissionHandler,
} from "./permission-protocol.js";
import type { Sandbox } from "./sandbox.js";

export type PermissionMode = "allow" | "ask" | "deny";

export interface WorkspacePermissionOptions {
  /** Default: allow */
  read?: PermissionMode;
  /** Default: allow */
  write?: PermissionMode;
  /** Default: ask */
  bash?: PermissionMode;
  /**
   * When bash mode is `ask`, commands matching these prefixes run without prompting.
   * Matched against trimmed command (case-sensitive prefix).
   */
  bashAllow?: string[];
}

export interface WorkspacePermissionPolicy {
  handler: PermissionHandler;
  grantSession: (toolCall: ToolCallPart) => void;
  grantRoot: (absDir: string) => void;
  /** Test/helper: clear session tool grants and session roots. */
  clearSession: () => void;
}

const DEFAULT_BASH_ALLOW = [
  "git ",
  "git\t",
  "pnpm ",
  "npm ",
  "ls",
  "ls ",
  "pwd",
  "cat ",
  "head ",
  "tail ",
  "rg ",
  "grep ",
  "echo ",
  "which ",
  "node -v",
  "node --version",
];

/**
 * Fluency-first policy:
 * read/write allow by default; bash asks (small allowlist auto-passes).
 * Paths outside sandbox roots ask to grant a session root.
 */
export function createWorkspacePermissionPolicy(
  sandbox: Sandbox,
  opts: WorkspacePermissionOptions = {},
): WorkspacePermissionPolicy {
  const read = opts.read ?? "allow";
  const write = opts.write ?? "allow";
  const bash = opts.bash ?? "ask";
  const bashAllow = opts.bashAllow ?? DEFAULT_BASH_ALLOW;
  const sessionGrants = new Set<string>();

  const handler: PermissionHandler = (
    ctx: PermissionContext,
  ): PermissionDecision => {
    const { name, arguments: args } = ctx.toolCall;

    if (name === "read_file" || name === "write_file" || name === "glob") {
      const userPath = pathArg(name, args);
      const probed = sandbox.probe(userPath);
      if (!probed.ok) {
        return {
          action: "ask",
          reason: `path outside sandbox → add session root "${probed.suggestedRoot}" for "${userPath}"`,
          grantRoot: probed.suggestedRoot,
        };
      }

      if (sessionGrants.has(name)) {
        return { action: "allow" };
      }

      if (name === "write_file") {
        return modeDecision(write, `write_file path="${userPath}"`);
      }
      return modeDecision(read, `read tool "${name}"`);
    }

    if (sessionGrants.has(name)) {
      return { action: "allow" };
    }

    if (name === "bash") {
      const command = typeof args.command === "string" ? args.command : "";
      const trimmed = command.trim();
      if (bash === "ask" && matchesAllowPrefix(trimmed, bashAllow)) {
        return { action: "allow" };
      }
      return modeDecision(
        bash,
        `bash: ${trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed}`,
      );
    }

    return { action: "allow" };
  };

  return {
    handler,
    grantSession(toolCall) {
      sessionGrants.add(toolCall.name);
    },
    grantRoot(absDir) {
      sandbox.grantRoot(absDir);
    },
    clearSession() {
      sessionGrants.clear();
      sandbox.clearSessionRoots();
    },
  };
}

function pathArg(name: string, args: Record<string, unknown>): string {
  if (name === "glob") {
    return typeof args.dir === "string" ? args.dir : ".";
  }
  return typeof args.path === "string" ? args.path : ".";
}

function modeDecision(mode: PermissionMode, reason: string): PermissionDecision {
  if (mode === "allow") return { action: "allow" };
  if (mode === "deny") return { action: "deny", reason };
  return { action: "ask", reason };
}

function matchesAllowPrefix(command: string, prefixes: string[]): boolean {
  if (!command) return false;
  for (const prefix of prefixes) {
    const p = prefix.trimEnd();
    if (prefix.endsWith(" ") || prefix.endsWith("\t")) {
      if (command.startsWith(prefix) || command === p) return true;
    } else if (command === p || command.startsWith(`${p} `)) {
      return true;
    }
  }
  return false;
}

export { DEFAULT_BASH_ALLOW };
