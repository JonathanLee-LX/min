import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { helpText, parseArgs, type CliArgs } from "./args.js";
import { loadEnvFiles } from "./load-env.js";
import { handleReplCommand } from "./repl.js";
import {
  attachMindSession,
  createCliClient,
  listSessions,
  runTurn,
  type CliClient,
} from "./run.js";
import { mergeSessionList } from "@min-agent/mind";

/** Run the one-shot / REPL CLI with already-parsed args. */
export async function runCli(args: CliArgs): Promise<void> {
  if (args.listSessions) {
    await listSessions(args);
    return;
  }

  if (!args.repl && !args.prompt) {
    console.log(helpText());
    process.exitCode = 1;
    return;
  }

  if (!args.repl) {
    const cli = await createCliClient(args);
    const st = cli.client.getStatus();
    console.error(`provider=${st.provider}  cwd=${args.cwd}`);
    console.error(
      `session=${st.sessionId}  strategy=${cli.client.advanced.runtime.contextStrategy}  maxContextTokens=${args.maxContextTokens}  maxTurns=${args.maxTurns}`,
    );
    await runOneShot(cli, args);
    return;
  }

  const attached = await attachMindSession(args);
  let remote = attached.remote;
  let lease = attached.lease;
  const cli: CliClient = { client: remote, args };
  const st = remote.getStatus();
  console.error(`provider=${st.provider}  cwd=${args.cwd}`);
  console.error(`session=${st.sessionId}  maxTurns=${args.maxTurns}`);
  if (!args.noTools) {
    const bashMode = args.allowBash || args.yes || args.auto ? "allow" : "ask";
    const writeMode = args.askWrite ? "ask" : "allow";
    const mode = args.auto ? "auto" : args.yes ? "yes" : "ask";
    console.error(
      `permissions: mode=${mode} read=allow write=${writeMode} bash=${bashMode}`,
    );
  }

  const needsRl =
    args.repl || (!(args.yes || args.auto) && process.stdin.isTTY);
  // Cooked mode. A TTY readline (raw mode) plus the old stdin "data"
  // listener left the permission question on screen but dropped keystrokes.
  const rl = needsRl
    ? createInterface({
        input,
        output,
        terminal: false,
      })
    : undefined;

  const switchSession = async (sessionId: string | null) => {
    const next = await attachMindSession(args, sessionId);
    const previousRemote = remote;
    const previousLease = lease;
    remote = next.remote;
    lease = next.lease;
    cli.client = remote;
    previousRemote.close();
    previousLease.close();
    next.mind.close();
  };

  try {
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
      if (cmd?.type === "sessions" || cmd?.type === "resume-list") {
        try {
          const listed = await attached.mind.list(args.cwd);
          const metas = mergeSessionList(listed);
          if (!metas.length) console.log("(no saved sessions)");
          const current = cli.client.getSession().id;
          for (const meta of metas) {
            const mark = meta.id === current ? "*" : " ";
            const title = meta.title ? `  ${meta.title}` : "";
            console.log(`${mark} ${meta.id}  ${meta.updatedAt}${title}`);
          }
          if (cmd.type === "resume-list") console.log("usage: /resume <session-id>");
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
        }
        continue;
      }
      if (cmd?.type === "resume") {
        try {
          await switchSession(cmd.id);
          const s = cli.client.getSession();
          console.log(
            `resumed ${s.id}  messages=${s.messageCount}  title=${s.title ?? "(untitled)"}`,
          );
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
        }
        continue;
      }
      if (cmd?.type === "new") {
        try {
          await switchSession(null);
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
    remote.close();
    lease.close();
    attached.mind.close();
  }
}

/** `min -p` stays inside this process and does not go through mind. */
async function runOneShot(cli: CliClient, args: CliArgs): Promise<void> {
  if (!args.noTools) {
    const bashMode = args.allowBash || args.yes || args.auto ? "allow" : "ask";
    const writeMode = args.askWrite ? "ask" : "allow";
    const mode = args.auto ? "auto" : args.yes ? "yes" : "ask";
    console.error(
      `permissions: mode=${mode} read=allow write=${writeMode} bash=${bashMode}`,
    );
  }
  const needsRl = !(args.yes || args.auto) && process.stdin.isTTY;
  const rl = needsRl
    ? createInterface({ input, output, terminal: false })
    : undefined;
  try {
    await runTurn(cli, args.prompt!, rl);
  } finally {
    rl?.close();
    if ("dispose" in cli.client) await cli.client.dispose();
  }
}

/** Direct `min` CLI entry (one-shot / REPL only). Prefer the `min` dispatcher. */
async function main(): Promise<void> {
  loadEnvFiles();
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

  await runCli(args);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("cli.ts") || entry.endsWith("cli.js")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
