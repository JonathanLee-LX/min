import type { Tool } from "@min-agent/core";
import type { Sandbox } from "./sandbox.js";
import {
  createWorkspacePermissionPolicy,
  type WorkspacePermissionOptions,
  type WorkspacePermissionPolicy,
} from "./permissions.js";
import {
  createWorkspaceTools,
  type WorkspaceToolsOptions,
} from "./tools.js";

export { createSandbox, SandboxError, type Sandbox, type ProbeResult } from "./sandbox.js";
export {
  createWorkspaceTools,
  type WorkspaceToolsOptions,
} from "./tools.js";
export {
  bashShape,
  describeGrant,
  emptyPermissionRules,
  loadPermissionRules,
  parsePermissionRules,
  permissionRulesPath,
  savePermissionRules,
  sameGrant,
  type BashShape,
  type PermissionGrant,
  type PermissionRules,
} from "./grants.js";
export {
  createWorkspacePermissionPolicy,
  DEFAULT_BASH_ALLOW,
  type PermissionMode,
  type PermissionRememberOptions,
  type WorkspacePermissionOptions,
  type WorkspacePermissionPolicy,
} from "./permissions.js";
export {
  createPermissionGate,
  type PermissionAskHandler,
  type PermissionAskRequest,
  type PermissionAskResult,
  type PermissionContext,
  type PermissionDecision,
  type PermissionGate,
  type PermissionHandler,
} from "./permission-protocol.js";

export type WorkspaceToolName =
  | "read_file"
  | "write_file"
  | "glob"
  | "bash";

export interface WorkspaceExtensionOptions extends WorkspaceToolsOptions {
  /** Subset of tools to register. Default: all. */
  include?: WorkspaceToolName[];
  /** Fluency-first permission policy. */
  permissions?: WorkspacePermissionOptions;
  /**
   * When false, the caller installs the handler (for example composed with
   * a skill pre-approval gate). Default true: `permissions.handler` is the
   * policy the host should wrap with {@link createPermissionGate}.
   */
  enforcePermissions?: boolean;
  /** Extra roots granted for the whole process/session at startup. */
  addRoots?: string[];
}

export interface WorkspaceToolsBundle {
  tools: Tool[];
  system: string;
  sandbox: Sandbox;
  permissions: WorkspacePermissionPolicy;
  /** False when `enforcePermissions` was set false. Host may ignore `permissions`. */
  enforcePermissions: boolean;
}

/**
 * Sandboxed workspace tools plus the system note and permission policy.
 * The host registers `tools` on the agent and wraps them with the policy.
 */
export function workspaceTools(
  opts: WorkspaceExtensionOptions = {},
): WorkspaceToolsBundle {
  const { sandbox, tools } = createWorkspaceTools(opts);
  if (opts.addRoots?.length) {
    sandbox.addRoots(opts.addRoots);
  }

  const allow = opts.include ? new Set(opts.include) : null;
  const filtered = allow
    ? tools.filter((t) => allow.has(t.name as WorkspaceToolName))
    : tools;

  const permissions = createWorkspacePermissionPolicy(sandbox, opts.permissions);
  const enforcePermissions = opts.enforcePermissions !== false;

  return {
    tools: filtered,
    sandbox,
    permissions,
    enforcePermissions,
    system: [
      "You have workspace tools scoped to a sandbox root.",
      `Primary sandbox root: ${sandbox.root}`,
      "Use relative paths when possible. Prefer read_file/glob before bash when inspecting files.",
      "Paths outside the sandbox require user approval to add a session root (tight directory only).",
      "Permission policy: reads/writes usually allowed inside roots; bash may require approval.",
      "Tools other than read_file, write_file, glob, and bash require approval unless the user has remembered that tool.",
      "When the user remembers a bash prompt, later simple commands with the same first token are allowed. Shell compounds are remembered only as that exact command.",
      "If a tool returns Permission denied, choose a safer approach or ask the user.",
    ].join("\n"),
  };
}
