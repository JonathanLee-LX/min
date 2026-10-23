import {
  createAgent,
  type Agent,
  type PermissionAskResult,
  type RunEvent,
} from "@min/core";
import { skills } from "@min/skills";
import {
  createFsStore,
  createSession,
  DEFAULT_MAX_CONTEXT_TOKENS,
  type Session,
  type SessionStore,
} from "@min/session";
import {
  workspaceTools,
  type WorkspacePermissionPolicy,
} from "@min/tools";
import { access } from "node:fs/promises";
import path from "node:path";
import type { Interface as ReadlineInterface } from "node:readline/promises";
import type { CliArgs } from "./args.js";
import { resolveProvider } from "./provider.js";

const BASE_SYSTEM = [
  "You are min, a concise coding agent.",
  "Use tools when they help. Keep answers short unless asked for detail.",
].join(" ");

export interface CliRuntime {
  agent: Agent;
  session: Session;
  store?: SessionStore;
  permissions?: WorkspacePermissionPolicy;
  args: CliArgs;
}

export function sessionDirFor(args: CliArgs): string {
  return path.resolve(args.sessionDir ?? path.join(args.cwd, ".min/sessions"));
}

export async function createCliRuntime(args: CliArgs): Promise<CliRuntime> {
  const extensions = [];
  let permissions: WorkspacePermissionPolicy | undefined;

  if (!args.noTools) {
    const ext = workspaceTools({
      root: args.cwd,
      addRoots: args.addRoots,
      permissions: {
        write: args.askWrite ? "ask" : "allow",
        bash: args.allowBash || args.yes ? "allow" : "ask",
      },
    });
    extensions.push(ext);
    permissions = ext.permissions;
  }

  const skillsDir = args.skillsDir
    ? path.resolve(args.skillsDir)
    : path.join(args.cwd, "skills");
  if (await exists(skillsDir)) {
    extensions.push(skills({ dirs: [skillsDir] }));
  }

  const agent = await createAgent({
    provider: resolveProvider({
      provider: args.provider,
      model: args.model,
    }),
    extensions,
    system: BASE_SYSTEM,
    maxTurns: 20,
  });

  const store = args.noSessionStore
    ? undefined
    : createFsStore(sessionDirFor(args));

  const session = await createSession({
    agent,
    store,
    id: args.sessionId,
    systemForBudget: BASE_SYSTEM,
    budget: {
      maxContextTokens: args.maxContextTokens || DEFAULT_MAX_CONTEXT_TOKENS,
      maxUserTurns: args.maxUserTurns,
      reservedOutputTokens: 1024,
    },
  });

  return { agent, session, store, permissions, args };
}

export async function listSessions(args: CliArgs): Promise<void> {
  const store = createFsStore(sessionDirFor(args));
  const metas = await store.list();
  if (!metas.length) {
    console.log(`(no sessions in ${sessionDirFor(args)})`);
    return;
  }
  for (const m of metas) {
    const title = m.title ? `  ${m.title}` : "";
    console.log(`${m.id}  ${m.updatedAt}${title}`);
  }
}

export async function runTurn(
  runtime: CliRuntime,
  prompt: string,
  rl?: ReadlineInterface,
): Promise<void> {
  const { session, permissions, args } = runtime;

  const result = await session.run(prompt, {
    onEvent: printEvent,
    onPermissionAsk: async (req) => {
      if (req.grantRoot) {
        if (args.allowRootGrant && (args.yes || !process.stdin.isTTY)) {
          permissions?.grantRoot(req.grantRoot);
          return "allow";
        }
        if (args.yes && !args.allowRootGrant) {
          return "deny";
        }
        if (!rl || !process.stdin.isTTY) {
          return "deny";
        }
        const answer = await promptRootGrant(rl, req.reason, req.grantRoot);
        if (answer === "deny") return "deny";
        permissions?.grantRoot(req.grantRoot);
        if (answer === "allow_session") {
          permissions?.grantSession(req.toolCall);
        }
        return answer;
      }

      if (args.yes) return "allow";
      if (!rl || !process.stdin.isTTY) return "deny";
      const answer = await promptPermission(rl, req.reason);
      if (answer === "allow_session" && permissions) {
        permissions.grantSession(req.toolCall);
      }
      return answer;
    },
  });

  const assembled = session.lastAssemble;
  if (assembled?.trimmed) {
    console.error(
      `context: trimmed ${assembled.dropped.length} msgs · view~${assembled.estimatedTokens} tokens (budget messages=${assembled.messageBudget})`,
    );
  }

  if (result.text) {
    process.stdout.write(`\n${result.text}\n`);
  }
}

async function promptPermission(
  rl: ReadlineInterface,
  reason: string,
): Promise<PermissionAskResult> {
  console.log(`\n⚠ permission: ${reason}`);
  const line = (
    await rl.question("Allow? [y]es / [n]o / [a]lways this tool > ")
  )
    .trim()
    .toLowerCase();

  if (line === "y" || line === "yes") return "allow";
  if (line === "a" || line === "always") return "allow_session";
  return "deny";
}

async function promptRootGrant(
  rl: ReadlineInterface,
  reason: string,
  grantRoot: string,
): Promise<PermissionAskResult> {
  console.log(`\n⚠ session root grant: ${reason}`);
  console.log(`   add root: ${grantRoot}`);
  const line = (
    await rl.question(
      "Grant session root? [y]es / [n]o / [a]lways (root + this tool) > ",
    )
  )
    .trim()
    .toLowerCase();

  if (line === "y" || line === "yes") return "allow";
  if (line === "a" || line === "always") return "allow_session";
  return "deny";
}

function printEvent(event: RunEvent): void {
  if (event.type === "tool_call") {
    const args = JSON.stringify(event.toolCall.arguments);
    const clipped = args.length > 120 ? `${args.slice(0, 117)}...` : args;
    console.log(`\n→ ${event.toolCall.name}(${clipped})`);
  } else if (event.type === "permission" && event.decision === "deny") {
    console.log(`⛔ denied ${event.toolCall.name}: ${event.reason ?? ""}`);
  } else if (event.type === "tool_result") {
    const body = event.content.replace(/\s+/g, " ").trim();
    const clipped = body.length > 160 ? `${body.slice(0, 157)}...` : body;
    console.log(`← ${event.isError ? "ERR " : ""}${clipped}`);
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
