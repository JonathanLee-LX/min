import type { ToolCallPart } from "@min/core";
import type { PermissionAnswer } from "./types.js";

/**
 * Non-interactive permission presets for hosts (CLI / TUI / Web).
 *
 * - `yes`  — approve tool prompts once; root expansion still denied unless
 *            `allowRootGrant` is set.
 * - `auto` — full-auto: approve as `allow_session` for this process and allow
 *            sandbox root grants. Pair with `persistPermissionGrants: false`
 *            so those grants are not written to `.min/permissions.json`.
 */
export type PermissionAutoMode = "yes" | "auto";

export interface AutoPermissionRequest {
  toolCall: ToolCallPart;
  reason: string;
  grantRoot?: string;
}

export function createAutoPermissionApprover(opts: {
  mode: PermissionAutoMode;
  /** Only used by `yes` mode. Default false. */
  allowRootGrant?: boolean;
}): (req: AutoPermissionRequest) => PermissionAnswer {
  const allowRootGrant = opts.allowRootGrant === true;
  return (req) => {
    if (opts.mode === "auto") {
      return "allow_session";
    }
    if (req.grantRoot && !allowRootGrant) {
      return "deny";
    }
    return "allow";
  };
}
