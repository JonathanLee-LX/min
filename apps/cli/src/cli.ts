import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Message } from "@min/core";
import { helpText, parseArgs } from "./args.js";
import { createCliAgent, runTurn } from "./run.js";

async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    console.log(helpText());
    return;
  }

  if (!args.repl && !args.prompt) {
    console.log(helpText());
    process.exitCode = 1;
    return;
  }

  const runtime = await createCliAgent(args);
  console.error(`provider=${runtime.agent.provider.id}  cwd=${args.cwd}`);
  if (!args.noTools) {
    const bashMode = args.allowBash || args.yes ? "allow" : "ask";
    const writeMode = args.askWrite ? "ask" : "allow";
    console.error(`permissions: read=allow write=${writeMode} bash=${bashMode}`);
  }

  // Shared readline for REPL + permission prompts
  const needsRl = args.repl || (!args.yes && process.stdin.isTTY);
  const rl = needsRl
    ? createInterface({ input, output, terminal: true })
    : undefined;

  try {
    if (!args.repl) {
      await runTurn(runtime, args.prompt!, rl);
      return;
    }

    let history: Message[] | undefined;
    if (args.prompt) {
      const first = await runTurn(runtime, args.prompt, rl);
      history = first.messages;
    }

    console.log("REPL — type a message, or /exit to quit.");

    while (true) {
      const line = (await rl!.question("\nmin> ")).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;

      const inputMessages: Message[] | string = history
        ? [...history, { role: "user", content: [{ type: "text", text: line }] }]
        : line;

      try {
        const turn = await runTurn(runtime, inputMessages, rl);
        history = turn.messages;
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
      }
    }
  } finally {
    rl?.close();
    await runtime.agent.dispose();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
