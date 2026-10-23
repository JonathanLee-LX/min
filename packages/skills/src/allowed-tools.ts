import type { PermissionHandler } from "@min/core";
import type { Skill } from "./types.js";

/**
 * Session allowlist while skills that declare `allowed-tools` are loaded.
 * Skills without the field do not widen a prior restriction.
 */
export interface AllowedToolsGate {
  /** Tools always permitted (default: load_skill). */
  readonly passthrough: ReadonlySet<string>;
  /** Active allowlist, or null when unrestricted. */
  activeAllowlist(): ReadonlySet<string> | null;
  /** Apply a skill's allowed-tools (intersect if already restricted). */
  activate(skill: Pick<Skill, "name" | "allowedTools">): void;
  reset(): void;
  /** Deny unknown tools when restricted; otherwise allow (pass to inner). */
  handler: PermissionHandler;
  /** Gate first (deny wins), then inner workspace/sandbox policy. */
  wrap(inner: PermissionHandler): PermissionHandler;
}

export interface AllowedToolsGateOptions {
  /** Tool names that bypass the allowlist. Default: ["load_skill"]. */
  passthrough?: string[];
}

export function createAllowedToolsGate(
  opts: AllowedToolsGateOptions = {},
): AllowedToolsGate {
  const passthrough = new Set(opts.passthrough ?? ["load_skill"]);
  /** null = no skill restriction active */
  let allow: Set<string> | null = null;

  const handler: PermissionHandler = (ctx) => {
    const name = ctx.toolCall.name;
    if (passthrough.has(name)) return { action: "allow" };
    if (!allow) return { action: "allow" };
    if (allow.has(name)) return { action: "allow" };
    return {
      action: "deny",
      reason: `Tool "${name}" is not in the active skill allowed-tools list (${[...allow].join(", ") || "empty"})`,
    };
  };

  return {
    passthrough,
    activeAllowlist() {
      return allow ? new Set(allow) : null;
    },
    activate(skill) {
      const list = skill.allowedTools;
      if (!list?.length) return;
      const next = new Set(list);
      if (!allow) {
        allow = next;
        return;
      }
      // Intersect: loading another restricted skill cannot widen the set.
      allow = new Set([...allow].filter((t) => next.has(t)));
    },
    reset() {
      allow = null;
    },
    handler,
    wrap(inner) {
      return async (ctx) => {
        const gated = await handler(ctx);
        if (gated.action === "deny") return gated;
        return inner(ctx);
      };
    },
  };
}
