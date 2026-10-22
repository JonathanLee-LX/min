import { createAgent, type Agent, type Message, type RunEvent } from "@min/core";
import { skills } from "@min/skills";
import { workspaceTools } from "@min/tools";
import { access } from "node:fs/promises";
import path from "node:path";
import type { CliArgs } from "./args.js";
import { resolveProvider } from "./provider.js";

export async function createCliAgent(args: CliArgs): Promise<Agent> {
  const extensions = [];

  if (!args.noTools) {
    extensions.push(workspaceTools({ root: args.cwd }));
  }

  const skillsDir = args.skillsDir
    ? path.resolve(args.skillsDir)
    : path.join(args.cwd, "skills");
  if (await exists(skillsDir)) {
    extensions.push(skills({ dirs: [skillsDir] }));
  }

  return createAgent({
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
}

export async function runTurn(
  agent: Agent,
  input: string | Message[],
): Promise<{ text: string; messages: Message[] }> {
  const result = await agent.run({
    input,
    onEvent: printEvent,
  });
  if (result.text) {
    process.stdout.write(`\n${result.text}\n`);
  }
  return { text: result.text, messages: result.messages };
}

function printEvent(event: RunEvent): void {
  if (event.type === "tool_call") {
    const args = JSON.stringify(event.toolCall.arguments);
    const clipped = args.length > 120 ? `${args.slice(0, 117)}...` : args;
    console.log(`\n→ ${event.toolCall.name}(${clipped})`);
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
