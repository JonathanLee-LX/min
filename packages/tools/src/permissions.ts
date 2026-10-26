import type { ToolCallPart } from "@min-agent/core";
import path from "node:path";
import {
  describeGrant,
  sameGrant,
  bashShape,
  type PermissionGrant,
  type PermissionRules,
} from "./grants.js";
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
  /**
   * Tool names that skip the unknown-tool ask.
   * Workspace tools are classified on their own and are not affected.
   * Default: none. Runtime trusts `load_skill` and `recall_context`.
   */
  trustedTools?: readonly string[];
  /**
   * Tools that are not read/write/glob/bash and not trusted.
   * Default: `ask`.
   */
  unknown?: PermissionMode;
  /** Durable grants and roots from `.min/permissions.json`. */
  rules?: PermissionRules;
  /** Called when a persisted grant or root changes. */
  onRulesChange?: (rules: PermissionRules) => void;
}

export interface PermissionRememberOptions {
  /** Write the grant or root into the host rules file. Default false. */
  persist?: boolean;
}

export interface WorkspacePermissionPolicy {
  handler: PermissionHandler;
  grantSession: (
    toolCall: ToolCallPart,
    opts?: PermissionRememberOptions,
  ) => PermissionGrant | undefined;
  grantRoot: (absDir: string, opts?: PermissionRememberOptions) => void;
  /** Test/helper: clear in-memory grants and session roots. Disk rules stay. */
  clearSession: () => void;
  /** Grants and roots that survive the process. */
  durableRules: () => PermissionRules;
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
  const unknown = opts.unknown ?? "ask";
  const bashAllow = opts.bashAllow ?? DEFAULT_BASH_ALLOW;
  const trusted = new Set(opts.trustedTools ?? []);
  const sessionGrants: PermissionGrant[] = [];
  const durableGrants: PermissionGrant[] = [...(opts.rules?.grants ?? [])];
  const persistedRoots: string[] = [];

  for (const root of opts.rules?.roots ?? []) {
    const before = new Set(sandbox.sessionRoots);
    sandbox.grantRoot(root);
    for (const added of sandbox.sessionRoots) {
      if (!before.has(added) && !persistedRoots.includes(added)) {
        persistedRoots.push(added);
      }
    }
  }

  const snapshot = (): PermissionRules => ({
    version: 1,
    grants: [...durableGrants],
    roots: [...persistedRoots],
  });

  const publish = () => {
    try {
      opts.onRulesChange?.(snapshot());
    } catch {
      // Memory grants still apply when the host cannot write the rules file.
    }
  };

  const remembered = (call: ToolCallPart): boolean => {
    const next = grantFor(sandbox, call);
    if (!next) return false;
    return [...durableGrants, ...sessionGrants].some((grant) =>
      sameGrant(grant, next),
    );
  };

  const remember = (grant: PermissionGrant, persist: boolean) => {
    if (!sessionGrants.some((existing) => sameGrant(existing, grant))) {
      sessionGrants.push(grant);
    }
    if (!persist) return;
    if (!durableGrants.some((existing) => sameGrant(existing, grant))) {
      durableGrants.push(grant);
      publish();
    }
  };

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

      const mode = name === "write_file" ? write : read;
      const reason =
        name === "write_file"
          ? `write_file path="${userPath}"`
          : `read tool "${name}"`;
      if (mode === "deny") return { action: "deny", reason };
      if (remembered(ctx.toolCall)) return { action: "allow" };
      if (mode === "allow") return { action: "allow" };
      const grant = grantFor(sandbox, ctx.toolCall);
      return {
        action: "ask",
        reason: grant ? `${reason} — always remembers ${describeGrant(grant)}` : reason,
      };
    }

    if (name === "bash") {
      const command = typeof args.command === "string" ? args.command : "";
      const trimmed = command.trim();
      const preview =
        trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
      const reason = `bash: ${preview}`;
      if (bash === "deny") return { action: "deny", reason };
      if (bash === "ask" && matchesAllowPrefix(trimmed, bashAllow)) {
        return { action: "allow" };
      }
      if (remembered(ctx.toolCall)) return { action: "allow" };
      if (bash === "allow") return { action: "allow" };
      const grant = grantFor(sandbox, ctx.toolCall);
      return {
        action: "ask",
        reason: grant ? `${reason} — always remembers ${describeGrant(grant)}` : reason,
      };
    }

    if (trusted.has(name) || remembered(ctx.toolCall)) {
      return { action: "allow" };
    }
    const reason = `tool "${name}" is outside the workspace policy`;
    if (unknown === "deny") return { action: "deny", reason };
    if (unknown === "allow") return { action: "allow" };
    const grant = grantFor(sandbox, ctx.toolCall);
    return {
      action: "ask",
      reason: grant ? `${reason} — always remembers ${describeGrant(grant)}` : reason,
    };
  };

  return {
    handler,
    grantSession(toolCall, rememberOpts) {
      const grant = grantFor(sandbox, toolCall);
      if (!grant) return undefined;
      remember(grant, rememberOpts?.persist === true);
      return grant;
    },
    grantRoot(absDir, rememberOpts) {
      const before = new Set(sandbox.sessionRoots);
      sandbox.grantRoot(absDir);
      if (rememberOpts?.persist !== true) return;
      let changed = false;
      for (const added of sandbox.sessionRoots) {
        if (!before.has(added) && !persistedRoots.includes(added)) {
          persistedRoots.push(added);
          changed = true;
        }
      }
      if (changed) publish();
    },
    clearSession() {
      sessionGrants.length = 0;
      sandbox.clearSessionRoots();
      for (const root of persistedRoots) sandbox.grantRoot(root);
    },
    durableRules: snapshot,
  };
}

function pathArg(name: string, args: Record<string, unknown>): string {
  if (name === "glob") {
    return typeof args.dir === "string" ? args.dir : ".";
  }
  return typeof args.path === "string" ? args.path : ".";
}

function pathGrantKey(sandbox: Sandbox, userPath: string): string {
  const probed = sandbox.probe(userPath);
  if (probed.ok && probed.root === sandbox.root) {
    const rel = path.relative(sandbox.root, probed.abs);
    return rel === "" ? "." : rel.split(path.sep).join("/");
  }
  let normalized = path.normalize(userPath.trim() || ".");
  if (normalized.startsWith(`./`)) normalized = normalized.slice(2);
  return normalized.split(path.sep).join("/");
}

function grantFor(sandbox: Sandbox, call: ToolCallPart): PermissionGrant | undefined {
  const args = call.arguments;
  if (call.name === "bash") {
    const shape = bashShape(typeof args.command === "string" ? args.command : "");
    if (!shape) return undefined;
    if (shape.kind === "prefix") return { kind: "bash-prefix", prefix: shape.prefix };
    return { kind: "bash-exact", command: shape.command };
  }
  if (call.name === "read_file" || call.name === "write_file" || call.name === "glob") {
    return {
      kind: "path",
      tool: call.name,
      path: pathGrantKey(sandbox, pathArg(call.name, args)),
    };
  }
  if (!call.name) return undefined;
  return { kind: "tool", name: call.name };
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
