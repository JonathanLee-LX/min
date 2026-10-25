import {
  createAgent,
  type Agent,
  type ModelProvider,
  type PermissionAskResult,
  type RunEvent,
} from "@min/core";
import {
  createFsStore,
  createSession,
  DEFAULT_MAX_CONTEXT_TOKENS,
  hmtContextExtension,
  recallContextExtension,
  type ContextStrategyId,
  type Session,
  type SessionStore,
} from "@min/session";
import { createAllowedToolsGate, skills } from "@min/skills";
import {
  workspaceTools,
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
   * Context projection strategy.
   * - `trim` (default): drop oldest turns under budget — eval baseline
   * - `hmt`: head/middle/tail + fold + stash; also registers `recall_context`
   *
   * H-M-T is opt-in while its effectiveness is still being measured.
   */
  contextStrategy?: ContextStrategyId;
  /** Session extensions (e.g. CLI logging). Later assemblers win. */
  sessionExtensions?: Parameters<typeof createSession>[0]["extensions"];
}

export interface Runtime {
  agent: Agent;
  session: Session;
  store?: SessionStore;
  permissions?: WorkspacePermissionPolicy;
  cwd: string;
  /** Active context strategy id. */
  contextStrategy: ContextStrategyId;
}

export function sessionDirFor(cwd: string, sessionDir?: string): string {
  return path.resolve(sessionDir ?? path.join(cwd, ".min/sessions"));
}

export async function createRuntime(
  opts: RuntimeOptions,
): Promise<Runtime> {
  const extensions = [];
  let permissions: WorkspacePermissionPolicy | undefined;
  const allowedToolsGate = createAllowedToolsGate();
  const contextStrategy: ContextStrategyId = opts.contextStrategy ?? "trim";

  if (!opts.noTools) {
    const ext = workspaceTools({
      root: opts.cwd,
      addRoots: opts.addRoots,
      enforcePermissions: false,
      permissions: {
        write: opts.askWrite ? "ask" : "allow",
        bash: opts.allowBash ? "allow" : "ask",
      },
    });
    extensions.push(ext);
    permissions = ext.permissions;
  }

  const hmt =
    contextStrategy === "hmt"
      ? hmtContextExtension({
          budget: {
            maxContextTokens:
              opts.maxContextTokens || DEFAULT_MAX_CONTEXT_TOKENS,
            maxUserTurns: opts.maxUserTurns,
            reservedOutputTokens: 1024,
          },
        })
      : undefined;

  if (hmt) {
    extensions.push(recallContextExtension(hmt.stash));
  }

  const skillsDir = opts.skillsDir
    ? path.resolve(opts.skillsDir)
    : path.join(opts.cwd, "skills");
  if (await exists(skillsDir)) {
    extensions.push(skills({ dirs: [skillsDir], allowedToolsGate }));
  }

  const permissionHandler = permissions
    ? allowedToolsGate.wrap(permissions.handler)
    : allowedToolsGate.handler;

  const agent = await createAgent({
    provider: opts.provider,
    extensions,
    permissionHandler,
    system: BASE_SYSTEM,
    maxTurns: 20,
  });

  const store = opts.noSessionStore
    ? undefined
    : createFsStore(sessionDirFor(opts.cwd, opts.sessionDir));

  const sessionExtensions = [
    ...(hmt ? [hmt] : []),
    ...(opts.sessionExtensions ?? []),
  ];

  const session = await createSession({
    agent,
    store,
    id: opts.sessionId,
    stash: hmt?.stash,
    systemForBudget: BASE_SYSTEM,
    budget: {
      maxContextTokens: opts.maxContextTokens || DEFAULT_MAX_CONTEXT_TOKENS,
      maxUserTurns: opts.maxUserTurns,
      reservedOutputTokens: 1024,
      stash: hmt?.stash,
    },
    extensions: sessionExtensions,
  });

  return {
    agent,
    session,
    store,
    permissions,
    cwd: opts.cwd,
    contextStrategy,
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
