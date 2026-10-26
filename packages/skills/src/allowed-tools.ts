import type { PermissionHandler } from "@min/tools";
import type { Skill } from "./types.js";

/**
 * Agent Skills `allowed-tools` (experimental): a space-separated list of
 * tools that are pre-approved to run.
 *
 * Loading a skill adds those names. It does not hide or deny other tools.
 * Pre-approval skips ordinary permission prompts (bash / write confirm).
 * Sandbox root grants (`ask` + `grantRoot`) and explicit denies still apply.
 */
export interface AllowedToolsGate {
  /** Tool names pre-approved by loaded skills. */
  preapproved(): ReadonlySet<string>;
  /** Union this skill's allowed-tools into the pre-approved set. */
  activate(skill: Pick<Skill, "name" | "allowedTools">): void;
  reset(): void;
  /**
   * Standalone handler: no skill-based restriction.
   * Hosts with a workspace policy should use {@link AllowedToolsGate.wrap}.
   */
  handler: PermissionHandler;
  /** Pre-approve listed tools, then defer to the inner policy. */
  wrap(inner: PermissionHandler): PermissionHandler;
}

export function createAllowedToolsGate(): AllowedToolsGate {
  const preapproved = new Set<string>();

  const apply = async (
    inner: PermissionHandler | undefined,
    ctx: Parameters<PermissionHandler>[0],
  ) => {
    if (!inner) return { action: "allow" as const };
    const decision = await inner(ctx);
    if (!preapproved.has(ctx.toolCall.name)) return decision;
    if (decision.action === "ask" && !decision.grantRoot) {
      return { action: "allow" as const };
    }
    return decision;
  };

  const handler: PermissionHandler = () => ({ action: "allow" });

  return {
    preapproved() {
      return new Set(preapproved);
    },
    activate(skill) {
      for (const name of skill.allowedTools ?? []) {
        if (name) preapproved.add(name);
      }
    },
    reset() {
      preapproved.clear();
    },
    handler,
    wrap(inner) {
      return (ctx) => apply(inner, ctx);
    },
  };
}
