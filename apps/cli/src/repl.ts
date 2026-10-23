import type { CliRuntime } from "./run.js";

export type ReplAction =
  | { type: "exit" }
  | { type: "prompt"; text: string }
  | { type: "handled" };

/** Handle slash commands. Returns null if `line` is not a command. */
export function handleReplCommand(
  runtime: CliRuntime,
  line: string,
): ReplAction | null {
  if (!line.startsWith("/")) return null;

  const [cmd, ...rest] = line.slice(1).trim().split(/\s+/);
  const name = (cmd ?? "").toLowerCase();

  if (name === "exit" || name === "quit" || name === "q") {
    return { type: "exit" };
  }

  if (name === "help" || name === "h" || name === "?") {
    console.log(`REPL commands:
  /help              show this help
  /session           show current session id / title / message count
  /reset             clear in-memory conversation history
  /queue             show follow-up queue size
  /dense             push next line as dense-latest (or: /dense <text>)
  /exit              quit (also /quit)

Follow-ups: push with session.inputQueue (or /dense). After the current
agent pass finishes, the session drains the queue and continues — @min/core
is unchanged. Rapid lines within 1.5s collapse to dense-latest.
Anything else is sent as a user message.`);
    return { type: "handled" };
  }

  if (name === "queue") {
    const n = runtime.session.inputQueue?.size ?? 0;
    const peek = runtime.session.inputQueue?.peek() ?? [];
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
    if (!runtime.session.inputQueue) {
      console.log("input queue disabled");
      return { type: "handled" };
    }
    runtime.session.inputQueue.push(text, { mode: "dense-latest" });
    console.log(`queued dense-latest (size=${runtime.session.inputQueue.size})`);
    return { type: "handled" };
  }

  if (name === "session") {
    const { session } = runtime;
    const title = session.meta.title ?? "(untitled)";
    const assemble = session.lastAssemble;
    console.log(`session ${session.id}`);
    console.log(`  title:    ${title}`);
    console.log(`  messages: ${session.messages.length}`);
    console.log(`  updated:  ${session.meta.updatedAt}`);
    if (assemble) {
      console.log(
        `  last view: ~${assemble.estimatedTokens} tokens · trimmed=${assemble.trimmed} · dropped=${assemble.dropped.length}`,
      );
    }
    return { type: "handled" };
  }

  if (name === "reset") {
    runtime.session.reset();
    console.log("session history cleared");
    return { type: "handled" };
  }

  // Unknown /token — treat as a normal prompt (paths like /tmp/x).
  return { type: "prompt", text: line };
}
