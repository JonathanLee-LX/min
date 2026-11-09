/**
 * Slash-command contract shared with the terminal UI.
 * The browser suggests and completes from this table. The server executes it.
 */

export interface SessionListItem {
  id: string;
  title?: string;
  updatedAt: string;
  messageCount?: number;
  turns?: number;
  preview?: string;
  latest?: string;
}

export type Command =
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
  | { type: "dense-usage" }
  | { type: "thinking" }
  | { type: "model-pick" }
  | { type: "model-set"; args: string[] }
  | { type: "effort" }
  | { type: "effort-set"; value: string }
  | { type: "name" }
  | { type: "name-set"; title: string };

export type SubmitRoute =
  | { type: "empty" }
  | { type: "send"; text: string }
  | { type: "queue"; text: string }
  | { type: "command"; command: Command }
  | { type: "busy-blocked"; name: string };

export interface CommandSpec {
  name: string;
  hint: string;
  arg?: boolean;
  pick?: boolean;
}

export const COMMANDS: readonly CommandSpec[] = [
  { name: "help", hint: "show this help" },
  { name: "context", hint: "context window used/limit and part breakdown" },
  { name: "version", hint: "show min version" },
  { name: "session", hint: "current session id, title, messages, queue" },
  { name: "sessions", hint: "list saved sessions" },
  { name: "resume", hint: "resume a saved session (list or id)", arg: true, pick: true },
  { name: "new", hint: "start a fresh session" },
  { name: "compact", hint: "summarize older turns and rewrite stored history" },
  { name: "reset", hint: "clear conversation history" },
  { name: "queue", hint: "show the follow-up queue" },
  { name: "thinking", hint: "expand / collapse thinking content" },
  { name: "model", hint: "pick a model (list or id)", arg: true, pick: true },
  { name: "effort", hint: "show or set thinking intensity", arg: true },
  { name: "name", hint: "generate a session name, or set one", arg: true },
  { name: "dense", hint: "queue text as a dense-latest supplement", arg: true },
  { name: "exit", hint: "close this tab" },
  { name: "quit", hint: "close this tab" },
];

/** Composer hint after Enter selects `/name` and the argument is still empty. */
export const NAME_PLACEHOLDER = "设置会话名称或者AI总结";

export function commandPlaceholder(text: string): string | undefined {
  if (!/^\/name\s+$/i.test(text)) return undefined;
  return NAME_PLACEHOLDER;
}

export function commandSuggestions(text: string): CommandSpec[] {
  if (!text.startsWith("/")) return [];
  const match = /^\/([^\s]*)$/.exec(text);
  if (!match) return [];
  const prefix = (match[1] ?? "").toLowerCase();
  return COMMANDS.filter((command) => command.name.startsWith(prefix));
}

export function applyCommandCompletion(text: string, selected: number): string | null {
  const matches = commandSuggestions(text);
  if (matches.length === 0) return null;
  const pick = matches[((selected % matches.length) + matches.length) % matches.length]!;
  return `/${pick.name}${pick.arg ? " " : ""}`;
}

export type SlashMenuEnter = { type: "run"; line: string } | { type: "fill"; text: string };

export function slashMenuEnter(command: CommandSpec): SlashMenuEnter {
  if (command.pick || !command.arg) return { type: "run", line: `/${command.name}` };
  return { type: "fill", text: `/${command.name} ` };
}

export function cycleCommandIndex(
  selected: number,
  count: number,
  direction: "up" | "down",
): number {
  if (count <= 0) return 0;
  const at = ((selected % count) + count) % count;
  return direction === "down" ? (at + 1) % count : (at - 1 + count) % count;
}

const BUSY_BLOCKED = new Set([
  "resume",
  "resume-pick",
  "new",
  "reset",
  "compact",
  "effort-set",
  "name",
  "name-set",
]);

export function parseCommand(line: string): Command {
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
  if (name === "resume" || name === "open") {
    const id = rest.join(" ").trim();
    return id ? { type: "resume", id } : { type: "resume-pick" };
  }
  if (name === "new") return { type: "new" };
  if (name === "compact") return { type: "compact" };
  if (name === "reset") return { type: "reset" };
  if (name === "queue") return { type: "queue" };
  if (name === "thinking" || name === "think") return { type: "thinking" };
  if (name === "model") {
    const args = rest.filter(Boolean);
    return args.length > 0 ? { type: "model-set", args } : { type: "model-pick" };
  }
  if (name === "effort") {
    const value = rest.join(" ").trim();
    return value ? { type: "effort-set", value } : { type: "effort" };
  }
  if (name === "name") {
    const value = rest.join(" ").trim();
    return value ? { type: "name-set", title: value } : { type: "name" };
  }
  if (name === "dense") {
    const text = rest.join(" ").trim();
    return text ? { type: "dense", text } : { type: "dense-usage" };
  }
  return { type: "prompt", text: trimmed };
}

export function routeSubmit(line: string, busy: boolean): SubmitRoute {
  const command = parseCommand(line);
  if (command.type === "prompt") {
    if (!command.text) return { type: "empty" };
    return busy ? { type: "queue", text: command.text } : { type: "send", text: command.text };
  }
  if (busy && BUSY_BLOCKED.has(command.type)) {
    return { type: "busy-blocked", name: blockedCommandName(command.type) };
  }
  return { type: "command", command };
}

function blockedCommandName(type: Command["type"]): string {
  if (type === "resume-pick") return "resume";
  if (type === "model-pick" || type === "model-set") return "model";
  if (type === "effort-set") return "effort";
  if (type === "name" || type === "name-set") return "name";
  return type;
}

export interface NamedProviderSpec {
  kind: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
}

export type ModelChange =
  | { type: "show" }
  | { type: "model"; model: string }
  | {
      type: "provider";
      kind: string;
      model?: string;
      baseURL?: string;
      apiKey?: string;
    }
  | { type: "error"; message: string };

export function resolveModelArgs(
  args: readonly string[],
  named: Readonly<Record<string, NamedProviderSpec>>,
  env: Record<string, string | undefined> = readEnv(),
): ModelChange {
  if (args.length === 0) return { type: "show" };
  if (args.length > 2) {
    return {
      type: "error",
      message: "usage: /model <model> | /model <provider> <model>",
    };
  }
  if (args.length === 2) {
    const kind = args[0]?.trim() ?? "";
    const model = args[1]?.trim() ?? "";
    if (!kind || !model) {
      return { type: "error", message: "usage: /model <provider> <model>" };
    }
    return { type: "provider", kind, model };
  }
  const name = args[0]?.trim() ?? "";
  if (!name) return { type: "error", message: "model name is empty" };
  const spec = named[name];
  if (spec) {
    const apiKey = spec.apiKeyEnv ? env[spec.apiKeyEnv] : undefined;
    return {
      type: "provider",
      kind: spec.kind,
      ...(spec.model ? { model: spec.model } : {}),
      ...(spec.baseUrl ? { baseURL: spec.baseUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
    };
  }
  return { type: "model", model: name };
}

export interface ModelPickItem {
  key: string;
  name: string;
  detail: string;
  current: boolean;
  supportsEffort: boolean;
  change: Extract<ModelChange, { type: "model" } | { type: "provider" }>;
}

export type EffortPickValue = "none" | "low" | "medium" | "high" | "max" | "default";

export interface EffortPickItem {
  value: EffortPickValue;
  name: string;
  detail: string;
  current: boolean;
}

const EFFORT_MENU: readonly { value: EffortPickValue; hint: string }[] = [
  { value: "none", hint: "off" },
  { value: "low", hint: "" },
  { value: "medium", hint: "" },
  { value: "high", hint: "" },
  { value: "max", hint: "" },
  { value: "default", hint: "adapter default" },
];

export function buildModelPickerItems(
  selection: { kind: string; model: string },
  models: readonly string[],
  named: Readonly<Record<string, NamedProviderSpec>>,
  supportsEffort: (kind: string, model?: string) => boolean,
  env: Record<string, string | undefined> = readEnv(),
): ModelPickItem[] {
  const items: ModelPickItem[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const id = model.trim();
    if (!id || seen.has(`model:${id}`)) continue;
    seen.add(`model:${id}`);
    const thinking = supportsEffort(selection.kind, id);
    items.push({
      key: `model:${id}`,
      name: id,
      detail: thinking ? "thinking" : "",
      current: id === selection.model,
      supportsEffort: thinking,
      change: { type: "model", model: id },
    });
  }
  for (const [name, spec] of Object.entries(named)) {
    const id = name.trim();
    if (!id || seen.has(`saved:${id}`)) continue;
    seen.add(`saved:${id}`);
    const model = spec.model?.trim();
    const thinking = supportsEffort(spec.kind, model);
    const detailParts = [spec.kind, model].filter(Boolean);
    if (thinking) detailParts.push("thinking");
    const apiKey = spec.apiKeyEnv ? env[spec.apiKeyEnv] : undefined;
    items.push({
      key: `saved:${id}`,
      name: id,
      detail: detailParts.join(" "),
      current: spec.kind === selection.kind && Boolean(model) && model === selection.model,
      supportsEffort: thinking,
      change: {
        type: "provider",
        kind: spec.kind,
        ...(model ? { model } : {}),
        ...(spec.baseUrl ? { baseURL: spec.baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
      },
    });
  }
  return items;
}

export function buildEffortPickerItems(current?: string): EffortPickItem[] {
  const active = current?.trim().toLowerCase() || "default";
  return EFFORT_MENU.map((item) => ({
    value: item.value,
    name: item.value,
    detail: item.hint,
    current: item.value === active,
  }));
}

export function formatModelStatus(info: {
  kind: string;
  model: string;
  effort?: string;
  models: readonly string[];
  saved: readonly string[];
}): string {
  const lines = [
    `provider ${info.kind}`,
    `model ${info.model}`,
    `effort ${info.effort ?? "(default)"}`,
  ];
  if (info.models.length > 0) lines.push(`models: ${info.models.join(", ")}`);
  if (info.saved.length > 0) lines.push(`saved: ${info.saved.join(", ")}`);
  return lines.join("\n");
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
      const name = collapse(meta.title || meta.preview || "(untitled)");
      const latest = collapse(meta.latest || "");
      const turns = meta.turns == null ? "" : meta.turns === 1 ? "1 turn" : `${meta.turns} turns`;
      const when = sessionWhen(meta.updatedAt);
      return [mark, name, latest, turns, when, shortSessionId(meta.id)].filter(Boolean).join("  ");
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

export function formatHelp(): string {
  const lines = ["Commands:"];
  const seen = new Set<string>();
  for (const command of COMMANDS) {
    if (command.name === "quit") continue;
    if (seen.has(command.name)) continue;
    seen.add(command.name);
    lines.push(`  /${command.name.padEnd(14)} ${command.hint}`);
  }
  lines.push(
    "  /quit           close this tab",
    "",
    "Keys:",
    "  Enter              send, run the highlighted /command, or queue while busy",
    "  Shift+Enter        insert a newline on a keyboard",
    "  Return on a phone  insert a newline; Send submits",
    "  Tab                complete a /command",
    "  Esc                stop the run while it is busy",
  );
  return lines.join("\n");
}

export function sessionWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.getFullYear() === now.getFullYear()) return clock;
  return `${date.getFullYear()}-${clock}`;
}

export function shortSessionId(id: string): string {
  if (id.length <= 12) return id;
  return `…${id.slice(-6)}`;
}

export function turnLabel(turns: number | undefined): string {
  if (turns == null) return "";
  return turns === 1 ? "1 turn" : `${turns} turns`;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function readEnv(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env ?? {};
}

export function visibleByQuery<T>(
  items: readonly T[],
  query: string,
  haystack: (item: T) => string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => haystack(item).toLowerCase().includes(q));
}
