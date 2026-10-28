import { attachSession, listWorkspaceSessions, type AttachedSession } from "@min-agent/mind";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { helpText, parseArgs, type CliArgs } from "./args.js";
import { loadEnvFiles } from "./load-env.js";
import { handleReplCommand } from "./repl.js";
import { createCliClient, listSessions, runTurn, type CliClient } from "./run.js";

function permissionModeOf(args: CliArgs) {
  if (args.auto) return "auto" as const;
  if (args.yes) return "yes" as const;
  return "ask" as const;
}

async function attachCliSession(args: CliArgs, sessionId?: string): Promise<AttachedSession> {
  return attachSession({
    cwd: args.cwd,
    provider: args.provider,
    model: args.model,
    sessionId,
    permissionMode: permissionModeOf(args),
    autoApprove: args.yes || args.auto,
    noTools: args.noTools,
  });
}

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
    await runOneShot(cli, args);
    return;
  }

  await runInteractive(args);
}

async function printBanner(cli: CliClient, args: CliArgs, inProcess: boolean): Promise<void> {
  const st = cli.client.getStatus();
  console.error(`provider=${st.provider}  cwd=${args.cwd}`);
  const strategy = inProcess ? cli.client.advanced.runtime.contextStrategy : "(client process)";
  console.error(
    `session=${st.sessionId}  strategy=${strategy}  maxContextTokens=${args.maxContextTokens}  maxTurns=${args.maxTurns}`,
  );
  if (!args.noTools) {
    const bashMode = args.allowBash || args.yes || args.auto ? "allow" : "ask";
    const writeMode = args.askWrite ? "ask" : "allow";
    const mode = args.auto ? "auto" : args.yes ? "yes" : "ask";
    console.error(
      `permissions: mode=${mode} read=allow write=${writeMode} bash=${bashMode}`,
    );
  }
}

async function runOneShot(cli: CliClient, args: CliArgs): Promise<void> {
  await printBanner(cli, args, true);
  const needsRl = !(args.yes || args.auto) && process.stdin.isTTY;
  const rl = needsRl
    ? createInterface({
        input,
        output,
        terminal: false,
      })
    : undefined;
  try {
    await runTurn(cli, args.prompt!, rl);
  } finally {
    rl?.close();
    await cli.client.dispose();
  }
}

async function listInteractiveSessions(cli: CliClient, cwd: string): Promise<void> {
  const listed = await listWorkspaceSessions(cwd);
  if (!listed.live.length && !listed.history.length) {
    console.log("(no saved sessions)");
    return;
  }
  const current = cli.client.getSession().id;
  const seen = new Set<string>();
  for (const live of listed.live) {
    seen.add(live.sessionId);
    const mark = live.sessionId === current ? "*" : " ";
    console.log(`${mark} ${live.sessionId}  (live pid=${live.pid})`);
  }
  for (const m of listed.history) {
    if (seen.has(m.id)) continue;
    const mark = m.id === current ? "*" : " ";
    const title = m.title ? `  ${m.title}` : "";
    console.log(`${mark} ${m.id}  ${m.updatedAt}${title}`);
  }
}

async function runInteractive(args: CliArgs): Promise<void> {
  let attached = await attachCliSession(args, args.sessionId);
  const cli: CliClient = { client: attached.client, args };
  await printBanner(cli, args, false);

  const rl = createInterface({
    input,
    output,
    terminal: false,
  });

  const switchTo = async (sessionId?: string) => {
    const next = await attachCliSession(args, sessionId);
    await attached.release();
    attached = next;
    cli.client = next.client;
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
        line = (await rl.question("\nmin> ")).trim();
      } catch {
        break;
      }
      if (!line) continue;

      const cmd = handleReplCommand(cli, line);
      if (cmd?.type === "exit") break;
      if (cmd?.type === "sessions") {
        try {
          await listInteractiveSessions(cli, args.cwd);
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
        }
        continue;
      }
      if (cmd?.type === "resume-list") {
        try {
          await listInteractiveSessions(cli, args.cwd);
          console.log("usage: /resume <session-id>");
        } catch (err) {
          console.error(err instanceof Error ? err.message : err);
        }
        continue;
      }
      if (cmd?.type === "resume") {
        try {
          await switchTo(cmd.id);
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
          await switchTo(undefined);
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
    rl.close();
    await attached.release();
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
