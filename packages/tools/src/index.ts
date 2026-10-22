import { defineExtension, type Extension, type Tool } from "@min/core";
import type { Sandbox } from "./sandbox.js";
import {
  createWorkspaceTools,
  type WorkspaceToolsOptions,
} from "./tools.js";

export { createSandbox, SandboxError, type Sandbox } from "./sandbox.js";
export {
  createWorkspaceTools,
  type WorkspaceToolsOptions,
} from "./tools.js";

export type WorkspaceToolName =
  | "read_file"
  | "write_file"
  | "glob"
  | "bash";

export interface WorkspaceExtensionOptions extends WorkspaceToolsOptions {
  /** Subset of tools to register. Default: all. */
  include?: WorkspaceToolName[];
}

/**
 * Register sandboxed workspace tools on the agent.
 */
export function workspaceTools(
  opts: WorkspaceExtensionOptions = {},
): Extension & { sandbox: Sandbox; tools: Tool[] } {
  const { sandbox, tools } = createWorkspaceTools(opts);
  const allow = opts.include ? new Set(opts.include) : null;
  const filtered = allow
    ? tools.filter((t) => allow.has(t.name as WorkspaceToolName))
    : tools;

  const ext = defineExtension({
    name: "workspace-tools",
    setup(api) {
      for (const tool of filtered) {
        api.registerTool(tool);
      }
      api.appendSystem(
        [
          "You have workspace tools scoped to a sandbox root.",
          `Sandbox root: ${sandbox.root}`,
          "Use relative paths. Prefer read_file/glob before bash when inspecting files.",
        ].join("\n"),
      );
    },
  });

  return Object.assign(ext, { sandbox, tools: filtered });
}
