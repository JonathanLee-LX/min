export interface SessionListItem {
  id: string;
  title?: string;
  updatedAt: string;
}

export type TuiCommand =
  | { type: "prompt"; text: string }
  | { type: "exit" }
  | { type: "help" }
  | { type: "context" }
  | { type: "version" }
  | { type: "session" }
  | { type: "sessions" }
  | { type: "resume"; id: string }
  | { type: "resume-pick" }
  | { type: "new" }
  | { type: "compact" }
  | { type: "reset" }
  | { type: "queue" }
  | { type: "dense"; text: string }
  | { type: "dense-usage" };

export type SubmitRoute =
  | { type: "empty" }
  | { type: "send"; text: string }
  | { type: "queue"; text: string }
  | { type: "command"; command: TuiCommand }
  | { type: "busy-blocked"; name: string };

export interface CommandSpec {
  name: string;
  hint: string;
  /** Commands that take an argument get a trailing space when completed. */
  arg?: boolean;
}

export const TUI_COMMANDS: readonly CommandSpec[] = [
  { name: "help", hint: "show this help" },
  { name: "context", hint: "context window used/limit and part breakdown" },
  { name: "version", hint: "show min version" },
  { name: "session", hint: "current session id, title, messages, queue" },
  { name: "sessions", hint: "list saved sessions" },
  { name: "resume", hint: "resume a saved session (list or id)", arg: true },
  { name: "new", hint: "start a fresh session" },
  { name: "compact", hint: "summarize older turns and rewrite stored history" },
  { name: "reset", hint: "clear conversation history" },
  { name: "queue", hint: "show the follow-up queue" },
  { name: "dense", hint: "queue text as a dense-latest supplement", arg: true },
  { name: "exit", hint: "quit" },
  { name: "quit", hint: "quit" },
];

export const TUI_HELP = `Commands:
  /help              show this help
  /context           context window used/limit and part breakdown
  /version           show min version
  /session           current session id, title, messages, queue
  /sessions          list saved sessions
  /resume            pick a saved session (↑↓ Enter); or /resume <id>
  /new               start a fresh session
  /compact           summarize older turns and rewrite stored history
  /reset             clear conversation history
  /queue             show the follow-up queue
  /dense <text>      queue text as a dense-latest supplement
  /exit /quit        quit

Keys:
  Enter              send, or queue while the agent is running
  Shift+Enter        insert a newline
  Tab                complete a /command
  Alt+Enter / Ctrl+J also insert a newline
  Up/Down            previous line, or input history at the ends
  PageUp/PageDown    scroll the transcript
  Ctrl+O             expand / collapse tool output
  Esc                abort the run while it is busy
  Ctrl+C             abort the run, or quit when idle
  Ctrl+A / Ctrl+E    start / end of line
  Ctrl+W / Ctrl+U    delete previous word / to line start`;

/** Slash command names matching a draft that has no arguments yet. */
export function commandSuggestions(text: string): CommandSpec[] {
  // Empty / non-slash drafts must yield nothing so the panel unmounts.
  if (!text.startsWith("/")) return [];
  const match = /^\/([^\s]*)$/.exec(text);
  if (!match) return [];
  const prefix = (match[1] ?? "").toLowerCase();
  return TUI_COMMANDS.filter((command) => command.name.startsWith(prefix));
}

/** Ghost suffix for the selected match, not including the typed prefix. */
export function commandGhost(text: string, selected: number): string {
  const matches = commandSuggestions(text);
  if (matches.length === 0) return "";
  const pick = matches[((selected % matches.length) + matches.length) % matches.length]!;
  const typed = text.slice(1).toLowerCase();
  const rest = pick.name.slice(typed.length);
  return `${rest}${pick.arg ? " " : ""}`;
}

/** Replace the draft with the selected slash command. */
export function applyCommandCompletion(text: string, selected: number): string | null {
  const matches = commandSuggestions(text);
  if (matches.length === 0) return null;
  const pick = matches[((selected % matches.length) + matches.length) % matches.length]!;
  return `/${pick.name}${pick.arg ? " " : ""}`;
}

/**
 * Fill the composer with the selected slash match while browsing the menu.
 * No trailing space so the panel stays open for arg commands until Tab/Enter.
 */
export function selectCommandCompletion(text: string, selected: number): string | null {
  const matches = commandSuggestions(text);
  if (matches.length === 0) return null;
  const pick = matches[((selected % matches.length) + matches.length) % matches.length]!;
  return `/${pick.name}`;
}

/** Next/previous index while cycling the slash menu. */
export function cycleCommandIndex(
  selected: number,
  count: number,
  direction: "up" | "down",
): number {
  if (count <= 0) return 0;
  const at = ((selected % count) + count) % count;
  return direction === "down" ? (at + 1) % count : (at - 1 + count) % count;
}

const BUSY_BLOCKED = new Set(["resume", "resume-pick", "new", "reset", "compact"]);

export function parseTuiCommand(line: string): TuiCommand {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) return { type: "prompt", text: trimmed };
  const [cmd, ...rest] = trimmed.slice(1).trim().split(/\s+/);
  const name = (cmd ?? "").toLowerCase();
  if (name === "exit" || name === "quit" || name === "q") return { type: "exit" };
  if (name === "help" || name === "h" || name === "?") return { type: "help" };
  if (name === "context" || name === "ctx") return { type: "context" };
  if (name === "version" || name === "v") return { type: "version" };
  if (name === "session") return { type: "session" };
  if (name === "sessions") return { type: "sessions" };
  // `/open` kept as a parse alias for `/resume`.
  if (name === "resume" || name === "open") {
    const id = rest.join(" ").trim();
    return id ? { type: "resume", id } : { type: "resume-pick" };
  }
  if (name === "new") return { type: "new" };
  if (name === "compact") return { type: "compact" };
  if (name === "reset") return { type: "reset" };
  if (name === "queue") return { type: "queue" };
  if (name === "dense") {
    const text = rest.join(" ").trim();
    return text ? { type: "dense", text } : { type: "dense-usage" };
  }
  return { type: "prompt", text: trimmed };
}

/** Decide what a submitted composer line does. Busy runs queue plain text. */
export function routeSubmit(line: string, busy: boolean): SubmitRoute {
  const command = parseTuiCommand(line);
  if (command.type === "prompt") {
    if (!command.text) return { type: "empty" };
    return busy ? { type: "queue", text: command.text } : { type: "send", text: command.text };
  }
  if (busy && BUSY_BLOCKED.has(command.type)) {
    const name = command.type === "resume-pick" ? "resume" : command.type;
    return { type: "busy-blocked", name };
  }
  return { type: "command", command };
}

export function formatSession(info: {
  id: string;
  title?: string;
  messageCount: number;
  provider: string;
  queueSize: number;
}): string {
  return [
    `session ${info.id}`,
    `  title:    ${info.title ?? "(untitled)"}`,
    `  messages: ${info.messageCount}`,
    `  provider: ${info.provider}`,
    `  queue:    ${info.queueSize}`,
  ].join("\n");
}

export function formatQueue(items: readonly string[]): string {
  if (items.length === 0) return "queue size=0";
  const lines = [`queue size=${items.length}`];
  items.forEach((item, index) => {
    const clipped = item.length > 80 ? `${item.slice(0, 77)}...` : item;
    lines.push(`  [${index}] ${clipped}`);
  });
  return lines.join("\n");
}

export function formatSessionList(
  metas: readonly SessionListItem[],
  currentId: string,
): string {
  if (metas.length === 0) return "(no saved sessions)";
  return metas
    .map((meta) => {
      const mark = meta.id === currentId ? "*" : " ";
      const title = meta.title ? `  ${meta.title}` : "";
      return `${mark} ${meta.id}  ${meta.updatedAt}${title}`;
    })
    .join("\n");
}

export function formatCompact(result: {
  summary: string;
  droppedMessageCount: number;
  keptTurns: number;
  messageCount: number;
}): string {
  if (!result.droppedMessageCount) {
    return `compact: nothing to summarize (messages=${result.messageCount})`;
  }
  const preview =
    result.summary.length > 240 ? `${result.summary.slice(0, 237)}...` : result.summary;
  const head = `compact: dropped ${result.droppedMessageCount} msgs, kept ${result.keptTurns} turn(s), now ${result.messageCount} msgs`;
  return preview ? `${head}\n${preview}` : head;
}
