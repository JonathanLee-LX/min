import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { helpText, parseArgs } from "./args.js";
import { createCliAgent, runTurn } from "./run.js";
import type { Message } from "@min/core";

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

  const agent = await createCliAgent(args);
  console.error(`provider=${agent.provider.id}  cwd=${args.cwd}`);

  try {
    if (!args.repl) {
      await runTurn(agent, args.prompt!);
      return;
    }

    let history: Message[] | undefined;
    if (args.prompt) {
      const first = await runTurn(agent, args.prompt);
      history = first.messages;
    }

    const rl = createInterface({ input, output, terminal: true });
    console.log('REPL — type a message, or /exit to quit.');

    while (true) {
      const line = (await rl.question("\nmin> ")).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;

      const inputMessages: Message[] | string = history
        ? [...history, { role: "user", content: [{ type: "text", text: line }] }]
        : line;

      try {
        const turn = await runTurn(agent, inputMessages);
        history = turn.messages;
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
      }
    }

    rl.close();
  } finally {
    await agent.dispose();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
