import type { InputAction, InputKey } from "./editor.js";

/**
 * Named composer commands that a chord can bind to.
 * Hosts may expose a subset in config; unknown command ids are ignored.
 */
export type KeyCommand =
  | "submit"
  | "newline"
  | "interrupt"
  | "toggle-tool-output"
  | "scroll-up"
  | "scroll-down"
  | "complete"
  | "home"
  | "end"
  | "backspace-word"
  | "kill-line-start"
  | "left"
  | "right"
  | "up"
  | "down"
  | "backspace"
  | "delete";

/**
 * Chord → command. Chords are lowercase, modifiers ordered
 * `ctrl`, `alt`, `shift`, then the key (`enter`, `j`, `pageup`, …).
 *
 * Future customization: merge user/project `ui.keybindings` on top of
 * {@link DEFAULT_KEYBINDINGS} via {@link resolveKeybindings}.
 */
export type KeybindingTable = Readonly<Record<string, KeyCommand>>;

/** Built-in defaults: Enter sends, Shift+Enter inserts a newline. */
export const DEFAULT_KEYBINDINGS: KeybindingTable = {
  enter: "submit",
  "shift+enter": "newline",
  "alt+enter": "newline",
  "ctrl+j": "newline",
  "ctrl+enter": "submit",
  escape: "interrupt",
  "ctrl+c": "interrupt",
  "ctrl+o": "toggle-tool-output",
  pageup: "scroll-up",
  pagedown: "scroll-down",
  tab: "complete",
  "ctrl+a": "home",
  "ctrl+e": "end",
  "ctrl+w": "backspace-word",
  "ctrl+u": "kill-line-start",
  left: "left",
  right: "right",
  up: "up",
  down: "down",
  backspace: "backspace",
  delete: "delete",
};

const COMMANDS = new Set<string>(Object.values(DEFAULT_KEYBINDINGS));

/** Merge sparse overrides onto defaults. Empty / unknown command clears a chord. */
export function resolveKeybindings(
  overrides?: Readonly<Record<string, string>> | null,
): KeybindingTable {
  if (!overrides || Object.keys(overrides).length === 0) return DEFAULT_KEYBINDINGS;
  const next: Record<string, KeyCommand> = { ...DEFAULT_KEYBINDINGS };
  for (const [rawChord, rawCommand] of Object.entries(overrides)) {
    const chord = normalizeChord(rawChord);
    if (!chord) continue;
    const command = rawCommand.trim().toLowerCase();
    if (!command) {
      delete next[chord];
      continue;
    }
    if (!COMMANDS.has(command)) continue;
    next[chord] = command as KeyCommand;
  }
  return next;
}

/** Normalize a user-facing chord string (`Shift+Enter` → `shift+enter`). */
export function normalizeChord(raw: string): string | null {
  const parts = raw
    .trim()
    .toLowerCase()
    .split(/[+\s]+/)
    .filter(Boolean)
    .map((part) => (part === "opt" || part === "option" || part === "meta" ? "alt" : part))
    .map((part) => (part === "return" || part === "ret" ? "enter" : part))
    .map((part) => (part === "esc" ? "escape" : part))
    .map((part) => (part === "pgup" ? "pageup" : part === "pgdn" || part === "pgdown" ? "pagedown" : part));
  if (parts.length === 0) return null;
  const key = parts[parts.length - 1]!;
  const mods = new Set(parts.slice(0, -1));
  const ordered: string[] = [];
  if (mods.has("ctrl") || mods.has("control")) ordered.push("ctrl");
  if (mods.has("alt")) ordered.push("alt");
  if (mods.has("shift")) ordered.push("shift");
  ordered.push(key);
  return ordered.join("+");
}

/**
 * Build the lookup chord for one decoded key event.
 * Character input with only Shift (e.g. typing `A`) returns null so it inserts.
 */
export function chordFromKey(input: string, key: InputKey): string | null {
  if (key.return) return withMods(key, "enter");
  if (key.escape) return withMods(key, "escape");
  if (key.tab) return withMods(key, "tab");
  if (key.pageUp) return withMods(key, "pageup");
  if (key.pageDown) return withMods(key, "pagedown");
  if (key.leftArrow) return withMods(key, "left");
  if (key.rightArrow) return withMods(key, "right");
  if (key.upArrow) return withMods(key, "up");
  if (key.downArrow) return withMods(key, "down");
  if (key.backspace) return withMods(key, "backspace");
  if (key.delete) return withMods(key, "delete");

  if (input.length === 1 && (key.ctrl || key.meta)) {
    return withMods(key, input.toLowerCase());
  }
  return null;
}

function withMods(key: InputKey, base: string): string {
  const parts: string[] = [];
  if (key.ctrl) parts.push("ctrl");
  if (key.meta) parts.push("alt");
  // Shift only counts as a modifier on named keys, not on plain letters.
  if (key.shift) parts.push("shift");
  parts.push(base);
  return parts.join("+");
}

export function actionFromCommand(command: KeyCommand): InputAction {
  switch (command) {
    case "submit":
      return { type: "submit" };
    case "newline":
      return { type: "edit", op: { op: "newline" } };
    case "interrupt":
      return { type: "interrupt" };
    case "toggle-tool-output":
      return { type: "toggle-tool-output" };
    case "scroll-up":
      return { type: "scroll", direction: "up" };
    case "scroll-down":
      return { type: "scroll", direction: "down" };
    case "complete":
      return { type: "complete" };
    case "home":
      return { type: "edit", op: { op: "home" } };
    case "end":
      return { type: "edit", op: { op: "end" } };
    case "backspace-word":
      return { type: "edit", op: { op: "backspaceWord" } };
    case "kill-line-start":
      return { type: "edit", op: { op: "killLineStart" } };
    case "left":
      return { type: "edit", op: { op: "left" } };
    case "right":
      return { type: "edit", op: { op: "right" } };
    case "up":
      return { type: "edit", op: { op: "up" } };
    case "down":
      return { type: "edit", op: { op: "down" } };
    case "backspace":
      return { type: "edit", op: { op: "backspace" } };
    case "delete":
      return { type: "edit", op: { op: "delete" } };
  }
}

/** Resolve a key event through the binding table; `null` means fall through to insert/ignore. */
export function lookupKeybinding(
  input: string,
  key: InputKey,
  bindings: KeybindingTable = DEFAULT_KEYBINDINGS,
): InputAction | null {
  const chord = chordFromKey(input, key);
  if (!chord) return null;
  const command = bindings[chord];
  if (!command) return null;
  return actionFromCommand(command);
}

/** First chord bound to `command` (for help / docs). */
export function chordsForCommand(
  command: KeyCommand,
  bindings: KeybindingTable = DEFAULT_KEYBINDINGS,
): string[] {
  return Object.entries(bindings)
    .filter(([, value]) => value === command)
    .map(([chord]) => chord);
}
