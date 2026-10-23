import { defineExtension, type Extension, type Tool } from "@min/core";
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
  createWorkspacePermissionPolicy,
  DEFAULT_BASH_ALLOW,
  type PermissionMode,
  type WorkspacePermissionOptions,
  type WorkspacePermissionPolicy,
} from "./permissions.js";

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
   * When false, do not install a permission handler
   * (caller may set their own). Default true.
   */
  enforcePermissions?: boolean;
  /** Extra roots granted for the whole process/session at startup. */
  addRoots?: string[];
}

/**
 * Register sandboxed workspace tools on the agent.
 */
export function workspaceTools(
  opts: WorkspaceExtensionOptions = {},
): Extension & {
  sandbox: Sandbox;
  tools: Tool[];
  permissions: WorkspacePermissionPolicy;
} {
  const { sandbox, tools } = createWorkspaceTools(opts);
  if (opts.addRoots?.length) {
    sandbox.addRoots(opts.addRoots);
  }

  const allow = opts.include ? new Set(opts.include) : null;
  const filtered = allow
    ? tools.filter((t) => allow.has(t.name as WorkspaceToolName))
    : tools;

  const permissions = createWorkspacePermissionPolicy(sandbox, opts.permissions);
  const enforce = opts.enforcePermissions !== false;

  const ext = defineExtension({
    name: "workspace-tools",
    setup(api) {
      for (const tool of filtered) {
        api.registerTool(tool);
      }
      if (enforce) {
        api.setPermissionHandler(permissions.handler);
      }
      api.appendSystem(
        [
          "You have workspace tools scoped to a sandbox root.",
          `Primary sandbox root: ${sandbox.root}`,
          "Use relative paths when possible. Prefer read_file/glob before bash when inspecting files.",
          "Paths outside the sandbox require user approval to add a session root (tight directory only).",
          "Permission policy: reads/writes usually allowed inside roots; bash may require approval.",
          "If a tool returns Permission denied, choose a safer approach or ask the user.",
        ].join("\n"),
      );
    },
  });

  return Object.assign(ext, { sandbox, tools: filtered, permissions });
}
