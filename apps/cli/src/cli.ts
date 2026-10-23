import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { helpText, parseArgs } from "./args.js";
import { loadEnvFiles } from "./load-env.js";
import { handleReplCommand } from "./repl.js";
import { createCliRuntime, listSessions, runTurn } from "./run.js";

loadEnvFiles();

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

  if (args.listSessions) {
    await listSessions(args);
    return;
  }

  if (!args.repl && !args.prompt) {
    console.log(helpText());
    process.exitCode = 1;
    return;
  }

  const runtime = await createCliRuntime(args);
  console.error(`provider=${runtime.agent.provider.id}  cwd=${args.cwd}`);
  console.error(
    `session=${runtime.session.id}  maxContextTokens=${args.maxContextTokens}`,
  );
  if (!args.noTools) {
    const bashMode = args.allowBash || args.yes ? "allow" : "ask";
    const writeMode = args.askWrite ? "ask" : "allow";
    console.error(`permissions: read=allow write=${writeMode} bash=${bashMode}`);
  }

  const needsRl = args.repl || (!args.yes && process.stdin.isTTY);
  const rl = needsRl
    ? createInterface({ input, output, terminal: true })
    : undefined;

  try {
    if (!args.repl) {
      await runTurn(runtime, args.prompt!, rl);
      return;
    }

    if (args.prompt) {
      await runTurn(runtime, args.prompt, rl);
    }

    console.log("REPL — type a message, /help for commands, Ctrl+C to interrupt a run.");

    while (true) {
      const line = (await rl!.question("\nmin> ")).trim();
      if (!line) continue;

      const cmd = handleReplCommand(runtime, line);
      if (cmd?.type === "exit") break;
      if (cmd?.type === "handled") continue;

      const prompt = cmd?.type === "prompt" ? cmd.text : line;

      try {
        await runTurn(runtime, prompt, rl);
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
      }
    }
  } finally {
    rl?.close();
    await runtime.session.dispose();
    await runtime.agent.dispose();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
