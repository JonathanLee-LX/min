import {
  createAgent,
  toolToDefinition,
  type Agent,
  type ModelProvider,
  type RunEvent,
  type Tool,
} from "@min-agent/core";
import {
  createFsStore,
  createSession,
  DEFAULT_MAX_CONTEXT_TOKENS,
  recallContextExtension,
  resolveContextStrategy,
  type ContextPartId,
  type ContextPartsSnapshot,
  type ContextStrategyId,
  type ContextSystemPart,
  type ContextToolGroup,
  type Session,
  type SessionStore,
} from "@min-agent/session";
import {
  createAllowedToolsGate,
  skills,
  type AllowedToolsGate,
} from "@min-agent/skills";
import {
  createPermissionGate,
  loadPermissionRules,
  permissionRulesPath,
  savePermissionRules,
  workspaceTools,
  type PermissionAskResult,
  type WorkspacePermissionPolicy,
} from "@min-agent/tools";
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

  const labeledSystem: ContextSystemPart[] = [{ id: "system", text: BASE_SYSTEM }];
  const toolBuckets = new Map<ContextPartId, Tool[]>();

  const appendSystem = (
    text: string,
    id: ContextSystemPart["id"] = "system",
  ) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    labeledSystem.push({ id, text: trimmed });
  };
  const addTools = (list: Tool[], id: ContextToolGroup["id"]) => {
    const bucket = toolBuckets.get(id) ?? [];
    bucket.push(...list);
    toolBuckets.set(id, bucket);
  };

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
    addTools(workspace.tools, "tools");
    appendSystem(workspace.system, "system");
    permissions = workspace.permissions;
  }

  if (resolved.needsRecall && resolved.stash) {
    const recall = recallContextExtension(resolved.stash);
    addTools([recall.tool], "tools");
    appendSystem(recall.system, "system");
  }

  const skillsDir = opts.skillsDir
    ? path.resolve(opts.skillsDir)
    : path.join(opts.cwd, "skills");
  if (await exists(skillsDir)) {
    const loaded = await skills({
      dirs: [skillsDir],
      allowedToolsGate,
      appendSystem: (text) => appendSystem(text, "skills"),
    });
    addTools(loaded.tools, "skills");
  }

  const tools: Tool[] = [...toolBuckets.values()].flat();

  const permissionHandler = permissions
    ? allowedToolsGate.wrap(permissions.handler)
    : allowedToolsGate.handler;
  const permissionGate = createPermissionGate(permissionHandler);

  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const liveSystem = () =>
    labeledSystem
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n");

  const agent = await createAgent({
    provider: opts.provider,
    tools: permissionGate.wrap(tools),
    system: liveSystem,
    maxTurns,
  });

  const contextParts = (): ContextPartsSnapshot => {
    const groups = new Map<ContextToolGroup["id"], ReturnType<typeof toolToDefinition>[]>();
    for (const [id, list] of toolBuckets) {
      groups.set(
        id as ContextToolGroup["id"],
        list.map(toolToDefinition),
      );
    }
    const known = new Set(
      [...groups.values()].flatMap((list) => list.map((tool) => tool.name)),
    );
    for (const def of agent.tools.definitions()) {
      if (known.has(def.name)) continue;
      const id: ContextToolGroup["id"] = looksLikeMcpTool(def.name) ? "mcp" : "tools";
      const bucket = groups.get(id) ?? [];
      bucket.push(def);
      groups.set(id, bucket);
    }
    return {
      systemParts: labeledSystem.map((part) => ({ ...part })),
      toolGroups: [...groups.entries()].map(([id, list]) => ({ id, tools: list })),
    };
  };

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
    systemForBudget: liveSystem,
    contextParts,
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

/** Host-added MCP tools are often named `server__tool` or `mcp_*`. */
function looksLikeMcpTool(name: string): boolean {
  return name.startsWith("mcp_") || name.includes("__");
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
