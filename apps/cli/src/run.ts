import {
  createAgent,
  type Agent,
  type Message,
  type PermissionAskResult,
  type RunEvent,
} from "@min/core";
import { skills } from "@min/skills";
import {
  workspaceTools,
  type WorkspacePermissionPolicy,
} from "@min/tools";
import { access } from "node:fs/promises";
import path from "node:path";
import type { Interface as ReadlineInterface } from "node:readline/promises";
import type { CliArgs } from "./args.js";
import { resolveProvider } from "./provider.js";

export interface CliRuntime {
  agent: Agent;
  permissions?: WorkspacePermissionPolicy;
  args: CliArgs;
}

export async function createCliAgent(args: CliArgs): Promise<CliRuntime> {
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
    system: [
      "You are min, a concise coding agent.",
      "Use tools when they help. Keep answers short unless asked for detail.",
    ].join(" "),
    maxTurns: 20,
  });

  return { agent, permissions, args };
}

export async function runTurn(
  runtime: CliRuntime,
  turnInput: string | Message[],
  rl?: ReadlineInterface,
): Promise<{ text: string; messages: Message[] }> {
  const { agent, permissions, args } = runtime;

  const result = await agent.run({
    input: turnInput,
    onEvent: printEvent,
    onPermissionAsk: async (req) => {
      // Root expansion: -y alone never grants; need --allow-root-grant or interactive.
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

      if (args.yes) {
        return "allow";
      }
      if (!rl || !process.stdin.isTTY) {
        return "deny";
      }
      const answer = await promptPermission(rl, req.reason);
      if (answer === "allow_session" && permissions) {
        permissions.grantSession(req.toolCall);
      }
      return answer;
    },
  });

  if (result.text) {
    process.stdout.write(`\n${result.text}\n`);
  }
  return { text: result.text, messages: result.messages };
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
