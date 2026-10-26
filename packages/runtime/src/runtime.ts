import {
  createAgent,
  type Agent,
  type ModelProvider,
  type RunEvent,
  type Tool,
} from "@min/core";
import {
  createFsStore,
  createSession,
  DEFAULT_MAX_CONTEXT_TOKENS,
  recallContextExtension,
  resolveContextStrategy,
  type ContextStrategyId,
  type Session,
  type SessionStore,
} from "@min/session";
import {
  createAllowedToolsGate,
  skills,
  type AllowedToolsGate,
} from "@min/skills";
import {
  createPermissionGate,
  loadPermissionRules,
  permissionRulesPath,
  savePermissionRules,
  workspaceTools,
  type PermissionAskResult,
  type WorkspacePermissionPolicy,
} from "@min/tools";
import { access } from "node:fs/promises";
import path from "node:path";

export const BASE_SYSTEM = [
  "You are min, a concise coding agent.",
  "Use tools when they help. Keep answers short unless asked for detail.",
].join(" ");

export interface RuntimeOptions {
  cwd: string;
  provider: ModelProvider;
  sessionId?: string;
  sessionDir?: string;
  noSessionStore?: boolean;
  noTools?: boolean;
  skillsDir?: string;
  addRoots?: string[];
  askWrite?: boolean;
  allowBash?: boolean;
  maxContextTokens?: number;
  maxUserTurns?: number;
  /**
   * Max model completes (tool-loop turns) per user message.
   * Default: 40. Override via CLI `--max-turns` / `MIN_MAX_TURNS`.
   */
  maxTurns?: number;
  /**
   * Context projection strategy (pluggable).
   * Default: `hybrid` when tools are enabled, otherwise `trim`.
   * Eval / override: `hmt` | `tool-offload` | `sticky-trim`.
   * On-demand LLM rewrite is `session.compact()` / Client `/compact` — not a strategy.
   */
  contextStrategy?: ContextStrategyId;
  /** Session extensions (e.g. CLI logging). Later assemblers win. */
  sessionExtensions?: Parameters<typeof createSession>[0]["extensions"];
}

/** Default agent tool-loop budget (model completes per user message). */
export const DEFAULT_MAX_TURNS = 40;

export interface Runtime {
  agent: Agent;
  session: Session;
  store?: SessionStore;
  permissions?: WorkspacePermissionPolicy;
  /** Skill `allowed-tools` pre-approval (does not restrict other tools). */
  allowedToolsGate: AllowedToolsGate;
  cwd: string;
  contextStrategy: ContextStrategyId;
  maxTurns: number;
}

export function sessionDirFor(cwd: string, sessionDir?: string): string {
  return path.resolve(sessionDir ?? path.join(cwd, ".min/sessions"));
}

export async function createRuntime(
  opts: RuntimeOptions,
): Promise<Runtime> {
  let permissions: WorkspacePermissionPolicy | undefined;
  const allowedToolsGate = createAllowedToolsGate();
  // Product default: hybrid when tools are on (stash + recall); trim otherwise.
  const contextStrategy: ContextStrategyId =
    opts.contextStrategy ?? (opts.noTools ? "trim" : "hybrid");

  const budget = {
    maxContextTokens: opts.maxContextTokens || DEFAULT_MAX_CONTEXT_TOKENS,
    maxUserTurns: opts.maxUserTurns,
    reservedOutputTokens: 1024,
  };

  const resolved = resolveContextStrategy({
    strategy: contextStrategy,
    budget,
    provider: opts.provider,
  });

  const systemParts = [BASE_SYSTEM];
  const appendSystem = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) systemParts.push(trimmed);
  };
  const tools: Tool[] = [];

  if (!opts.noTools) {
    const rulesFile = permissionRulesPath(opts.cwd);
    const workspace = workspaceTools({
      root: opts.cwd,
      addRoots: opts.addRoots,
      enforcePermissions: false,
      permissions: {
        write: opts.askWrite ? "ask" : "allow",
        bash: opts.allowBash ? "allow" : "ask",
        trustedTools: ["recall_context", "load_skill"],
        rules: loadPermissionRules(rulesFile),
        onRulesChange(next) {
          savePermissionRules(rulesFile, next);
        },
      },
    });
    tools.push(...workspace.tools);
    appendSystem(workspace.system);
    permissions = workspace.permissions;
  }

  if (resolved.needsRecall && resolved.stash) {
    const recall = recallContextExtension(resolved.stash);
    tools.push(recall.tool);
    appendSystem(recall.system);
  }

  const skillsDir = opts.skillsDir
    ? path.resolve(opts.skillsDir)
    : path.join(opts.cwd, "skills");
  if (await exists(skillsDir)) {
    const loaded = await skills({
      dirs: [skillsDir],
      allowedToolsGate,
      appendSystem,
    });
    tools.push(...loaded.tools);
  }

  const permissionHandler = permissions
    ? allowedToolsGate.wrap(permissions.handler)
    : allowedToolsGate.handler;
  const permissionGate = createPermissionGate(permissionHandler);

  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;

  const agent = await createAgent({
    provider: opts.provider,
    tools: permissionGate.wrap(tools),
    system: () => systemParts.join("\n\n"),
    maxTurns,
  });

  const store = opts.noSessionStore
    ? undefined
    : createFsStore(sessionDirFor(opts.cwd, opts.sessionDir));

  const sessionExtensions = [
    ...(resolved.extension ? [resolved.extension] : []),
    ...(opts.sessionExtensions ?? []),
  ];

  const session = await createSession({
    agent,
    store,
    id: opts.sessionId,
    stash: resolved.stash,
    systemForBudget: BASE_SYSTEM,
    budget: {
      ...budget,
      stash: resolved.stash,
    },
    extensions: sessionExtensions,
    bindPermissionAsk: (ask) => permissionGate.setAsk(ask),
  });

  return {
    agent,
    session,
    store,
    permissions,
    allowedToolsGate,
    cwd: opts.cwd,
    contextStrategy,
    maxTurns,
  };
}

export type { PermissionAskResult, RunEvent };

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
