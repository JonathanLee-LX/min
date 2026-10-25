import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { helpText, parseArgs } from "./args.js";
import { loadEnvFiles } from "./load-env.js";
import { handleReplCommand, listSessionsViaClient } from "./repl.js";
import { createCliClient, listSessions, runTurn } from "./run.js";

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

  const cli = await createCliClient(args);
  const st = cli.client.getStatus();
  console.error(`provider=${st.provider}  cwd=${args.cwd}`);
  console.error(
    `session=${st.sessionId}  strategy=${cli.client.advanced.runtime.contextStrategy}  maxContextTokens=${args.maxContextTokens}`,
  );
  if (!args.noTools) {
    const bashMode = args.allowBash || args.yes ? "allow" : "ask";
    const writeMode = args.askWrite ? "ask" : "allow";
    console.error(`permissions: read=allow write=${writeMode} bash=${bashMode}`);
  }

  const needsRl = args.repl || (!args.yes && process.stdin.isTTY);
  const rl = needsRl
    ? createInterface({
        input,
        output,
        terminal: Boolean(process.stdin.isTTY),
      })
    : undefined;

  try {
    if (!args.repl) {
      await runTurn(cli, args.prompt!, rl);
      return;
    }

    if (args.prompt) {
      await runTurn(cli, args.prompt, rl);
    }

    console.log(
      "REPL — type a message, /help for commands, Ctrl+C to interrupt a run.",
    );

    while (true) {
      let line: string;
      try {
        line = (await rl!.question("\nmin> ")).trim();
      } catch {
        break;
      }
      if (!line) continue;

      const cmd = handleReplCommand(cli, line);
      if (cmd?.type === "exit") break;
      if (cmd?.type === "sessions") {
        try {
          await listSessionsViaClient(cli);
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
        }
        continue;
      }
      if (cmd?.type === "open") {
        try {
          await cli.client.openSession(cmd.id);
          const s = cli.client.getSession();
          console.log(
            `opened ${s.id}  messages=${s.messageCount}  title=${s.title ?? "(untitled)"}`,
          );
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
        }
        continue;
      }
      if (cmd?.type === "new") {
        try {
          await cli.client.newSession();
          console.log(`new session ${cli.client.getSession().id}`);
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
        }
        continue;
      }
      if (cmd?.type === "compact") {
        try {
          const result = await cli.client.compact();
          if (!result.droppedMessageCount) {
            console.log(
              `compact: nothing to summarize (messages=${result.messageCount})`,
            );
          } else {
            console.log(
              `compact: dropped ${result.droppedMessageCount} msgs, kept ${result.keptTurns} turn(s), now ${result.messageCount} msgs`,
            );
            if (result.summary) {
              const preview =
                result.summary.length > 240
                  ? `${result.summary.slice(0, 237)}...`
                  : result.summary;
              console.log(preview);
            }
          }
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
        }
        continue;
      }
      if (cmd?.type === "handled") continue;

      const prompt = cmd?.type === "prompt" ? cmd.text : line;

      try {
        await runTurn(cli, prompt, rl);
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
      }
    }
  } finally {
    rl?.close();
    await cli.client.dispose();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
