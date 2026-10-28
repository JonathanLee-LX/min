import { formatContextUsageReport } from "@min-agent/session";
import type { CliClient } from "./run.js";
import { formatVersionLine } from "./version.js";

export type ReplAction =
  | { type: "exit" }
  | { type: "prompt"; text: string }
  | { type: "handled" }
  | { type: "sessions" }
  | { type: "resume"; id: string }
  | { type: "resume-list" }
  | { type: "new" }
  | { type: "compact" };

/** Handle slash commands. Returns null if `line` is not a command. */
export function handleReplCommand(
  cli: CliClient,
  line: string,
): ReplAction | null {
  if (!line.startsWith("/")) return null;

  const [cmd, ...rest] = line.slice(1).trim().split(/\s+/);
  const name = (cmd ?? "").toLowerCase();
  const { client } = cli;

  if (name === "exit" || name === "quit" || name === "q") {
    return { type: "exit" };
  }

  if (name === "help" || name === "h" || name === "?") {
    console.log(`REPL commands:
  /help              show this help
  /context           context window used/limit and part breakdown
  /version           show min version
  /session           show current session id / title / message count
  /sessions          list saved sessions (via Client)
  /resume            list sessions; /resume <id> switch
  /new               start a fresh session
  /compact           summarize older turns and rewrite stored history
  /reset             clear in-memory conversation history
  /queue             show follow-up queue size
  /dense             push next line as dense-latest (or: /dense <text>)
  /exit              quit (also /quit)

Follow-ups: client.queue (or /dense). After the current agent pass finishes,
the session drains the queue and continues. Rapid lines within 1.5s collapse
to dense-latest. Anything else is sent as a user message.`);
    return { type: "handled" };
  }

  if (name === "context" || name === "ctx") {
    console.log(formatContextUsageReport(client.getStatus().context));
    return { type: "handled" };
  }

  if (name === "version" || name === "v") {
    console.log(formatVersionLine());
    return { type: "handled" };
  }

  if (name === "queue") {
    const n = client.queue.size;
    const peek = client.queue.peek();
    console.log(`queue size=${n}`);
    for (const [i, t] of peek.entries()) {
      const clipped = t.length > 80 ? `${t.slice(0, 77)}...` : t;
      console.log(`  [${i}] ${clipped}`);
    }
    return { type: "handled" };
  }

  if (name === "dense") {
    const text = rest.join(" ").trim();
    if (!text) {
      console.log("usage: /dense <text>  — queue as dense-latest supplement");
      return { type: "handled" };
    }
    try {
      client.queue.push(text, { mode: "dense-latest" });
      console.log(`queued dense-latest (size=${client.queue.size})`);
    } catch (err) {
      console.log(err instanceof Error ? err.message : String(err));
    }
    return { type: "handled" };
  }

  if (name === "session") {
    const s = client.getSession();
    const st = client.getStatus();
    console.log(`session ${s.id}`);
    console.log(`  title:    ${s.title ?? "(untitled)"}`);
    console.log(`  messages: ${s.messageCount}`);
    console.log(`  provider: ${st.provider}`);
    console.log(`  queue:    ${st.queueSize}`);
    return { type: "handled" };
  }

  if (name === "sessions") {
    return { type: "sessions" };
  }

  if (name === "resume" || name === "open") {
    const id = rest.join(" ").trim();
    if (!id) return { type: "resume-list" };
    return { type: "resume", id };
  }

  if (name === "new") {
    return { type: "new" };
  }

  if (name === "reset") {
    client.reset();
    console.log("session history cleared");
    return { type: "handled" };
  }

  if (name === "compact") {
    return { type: "compact" };
  }

  return { type: "prompt", text: line };
}

/** Async bits for /sessions (keeps handleReplCommand sync for tests). */
export async function listSessionsViaClient(cli: CliClient): Promise<void> {
  const metas = await cli.client.listSessions();
  if (!metas.length) {
    console.log("(no saved sessions)");
    return;
  }
  const current = cli.client.getSession().id;
  for (const m of metas) {
    const mark = m.id === current ? "*" : " ";
    const title = m.title ? `  ${m.title}` : "";
    console.log(`${mark} ${m.id}  ${m.updatedAt}${title}`);
  }
}
