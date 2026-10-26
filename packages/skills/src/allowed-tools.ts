import type { PermissionHandler } from "@min/core";
import type { Skill } from "./types.js";

/**
 * Session allowlist while skills that declare `allowed-tools` are loaded.
 * Skills without the field do not widen a prior restriction.
 *
 * Tools outside the allowlist are not hard-denied: the gate returns `ask`
 * so the host can prompt the user. `grantSession` records an approved
 * escape for the rest of the session (CLI/Client "always this tool").
 */
export interface AllowedToolsGate {
  /** Tools always permitted (default: load_skill). */
  readonly passthrough: ReadonlySet<string>;
  /** Active allowlist, or null when unrestricted. */
  activeAllowlist(): ReadonlySet<string> | null;
  /** Tools granted via user approval outside the skill allowlist. */
  sessionGrants(): ReadonlySet<string>;
  /** Apply a skill's allowed-tools (intersect if already restricted). */
  activate(skill: Pick<Skill, "name" | "allowedTools">): void;
  /** Persist a user-approved tool for the rest of the session. */
  grantSession(toolName: string): void;
  reset(): void;
  /** Ask (or allow via grant) when restricted; otherwise allow. */
  handler: PermissionHandler;
  /** Gate first (ask/deny wins before allow), then inner workspace/sandbox policy. */
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
  const grants = new Set<string>();

  const handler: PermissionHandler = (ctx) => {
    const name = ctx.toolCall.name;
    if (passthrough.has(name)) return { action: "allow" };
    if (!allow) return { action: "allow" };
    if (allow.has(name)) return { action: "allow" };
    if (grants.has(name)) return { action: "allow" };
    const list = [...allow].join(", ") || "empty";
    return {
      action: "ask",
      reason: `Tool "${name}" is outside the active skill allowed-tools (${list}). Approve once, or always for this session, to continue outside the skill.`,
    };
  };

  return {
    passthrough,
    activeAllowlist() {
      return allow ? new Set(allow) : null;
    },
    sessionGrants() {
      return new Set(grants);
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
    grantSession(toolName) {
      if (toolName) grants.add(toolName);
    },
    reset() {
      allow = null;
      grants.clear();
    },
    handler,
    wrap(inner) {
      return async (ctx) => {
        const gated = await handler(ctx);
        // ask | deny stop before inner; only allow continues to workspace policy.
        if (gated.action !== "allow") return gated;
        return inner(ctx);
      };
    },
  };
}
