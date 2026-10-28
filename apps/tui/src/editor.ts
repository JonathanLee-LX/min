import { displayWidth, nextBound, previousBound } from "./text.js";

export interface EditorState {
  text: string;
  /** UTF-16 offset on a grapheme boundary. */
  cursor: number;
  history: readonly string[];
  /** `history.length` means the draft line, not a history entry. */
  historyAt: number;
  draft: string;
}

export type EditorOp =
  | { op: "insert"; text: string }
  | { op: "backspace" }
  | { op: "delete" }
  | { op: "left" }
  | { op: "right" }
  | { op: "home" }
  | { op: "end" }
  | { op: "up" }
  | { op: "down" }
  | { op: "newline" }
  | { op: "backspaceWord" }
  | { op: "killLineStart" };

export interface InputKey {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageDown: boolean;
  pageUp: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
}

export type InputAction =
  | { type: "edit"; op: EditorOp }
  | { type: "submit" }
  | { type: "complete" }
  | { type: "scroll"; direction: "up" | "down" }
  | { type: "toggle-tool-output" }
  | { type: "interrupt" }
  | { type: "ignore" };

export function createEditor(): EditorState {
  return { text: "", cursor: 0, history: [], historyAt: 0, draft: "" };
}

export function reduceEditor(state: EditorState, op: EditorOp): EditorState {
  switch (op.op) {
    case "insert":
      return insert(state, op.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
    case "newline":
      return insert(state, "\n");
    case "backspace":
      return deleteRange(state, previousBound(state.text, state.cursor), state.cursor);
    case "delete":
      return deleteRange(state, state.cursor, nextBound(state.text, state.cursor));
    case "left":
      return moveCursor(state, previousBound(state.text, state.cursor));
    case "right":
      return moveCursor(state, nextBound(state.text, state.cursor));
    case "home":
      return moveCursor(state, lineStart(state.text, state.cursor));
    case "end":
      return moveCursor(state, lineEnd(state.text, state.cursor));
    case "backspaceWord":
      return deleteRange(state, wordStart(state.text, state.cursor), state.cursor);
    case "killLineStart":
      return deleteRange(state, lineStart(state.text, state.cursor), state.cursor);
    case "up":
      return moveVertical(state, -1);
    case "down":
      return moveVertical(state, 1);
    default:
      return state;
  }
}

export function commitEditor(state: EditorState): { state: EditorState; text: string } {
  const text = state.text.trim();
  const history =
    text && state.history[state.history.length - 1] !== text
      ? [...state.history, text]
      : state.history;
  return {
    text,
    state: {
      text: "",
      cursor: 0,
      history,
      historyAt: history.length,
      draft: "",
    },
  };
}

/** Cursor glyph and the text on either side, for an inverse-cursor render. */
export function editorCaret(state: EditorState): {
  before: string;
  caret: string;
  after: string;
} {
  if (state.cursor >= state.text.length) {
    return { before: state.text, caret: " ", after: "" };
  }
  const end = nextBound(state.text, state.cursor);
  return {
    before: state.text.slice(0, state.cursor),
    caret: state.text.slice(state.cursor, end) || " ",
    after: state.text.slice(end),
  };
}

export function inputAction(input: string, key: InputKey): InputAction {
  if (key.ctrl && input === "c") return { type: "interrupt" };
  // Escape aborts a running turn while the composer is focused (does not quit).
  if (key.escape) return { type: "interrupt" };
  if (key.ctrl && input === "o") return { type: "toggle-tool-output" };
  if (key.pageUp) return { type: "scroll", direction: "up" };
  if (key.pageDown) return { type: "scroll", direction: "down" };
  // Newline: Shift/Alt/Ctrl+Enter, or Ctrl+J. Plain Enter submits.
  if (key.return && (key.meta || key.shift || key.ctrl)) {
    return { type: "edit", op: { op: "newline" } };
  }
  if (key.ctrl && input === "j") return { type: "edit", op: { op: "newline" } };
  if (key.return) return { type: "submit" };
  if (key.backspace) return { type: "edit", op: { op: "backspace" } };
  if (key.delete) return { type: "edit", op: { op: "delete" } };
  if (key.leftArrow) return { type: "edit", op: { op: "left" } };
  if (key.rightArrow) return { type: "edit", op: { op: "right" } };
  if (key.upArrow) return { type: "edit", op: { op: "up" } };
  if (key.downArrow) return { type: "edit", op: { op: "down" } };
  if (key.ctrl && input === "a") return { type: "edit", op: { op: "home" } };
  if (key.ctrl && input === "e") return { type: "edit", op: { op: "end" } };
  if (key.ctrl && input === "u") return { type: "edit", op: { op: "killLineStart" } };
  if (key.ctrl && input === "w") return { type: "edit", op: { op: "backspaceWord" } };
  if (key.tab) return { type: "complete" };
  if (key.ctrl || key.meta) return { type: "ignore" };
  if (!input) return { type: "ignore" };
  return { type: "edit", op: { op: "insert", text: input } };
}

function insert(state: EditorState, chunk: string): EditorState {
  if (!chunk) return state;
  const text = state.text.slice(0, state.cursor) + chunk + state.text.slice(state.cursor);
  return { ...state, text, cursor: state.cursor + chunk.length };
}

function deleteRange(state: EditorState, from: number, to: number): EditorState {
  if (to <= from) return state;
  return {
    ...state,
    text: state.text.slice(0, from) + state.text.slice(to),
    cursor: from,
  };
}

function moveCursor(state: EditorState, cursor: number): EditorState {
  return { ...state, cursor };
}

function lineStart(text: string, cursor: number): number {
  const index = text.lastIndexOf("\n", Math.max(0, cursor - 1));
  return index === -1 ? 0 : index + 1;
}

function lineEnd(text: string, cursor: number): number {
  const index = text.indexOf("\n", cursor);
  return index === -1 ? text.length : index;
}

function wordStart(text: string, cursor: number): number {
  let at = cursor;
  while (at > 0) {
    const prev = previousBound(text, at);
    if (!/\s/u.test(text.slice(prev, at))) break;
    at = prev;
  }
  while (at > 0) {
    const prev = previousBound(text, at);
    if (/\s/u.test(text.slice(prev, at))) break;
    at = prev;
  }
  return at;
}

function moveVertical(state: EditorState, direction: -1 | 1): EditorState {
  const lines = state.text.split("\n");
  const { line, column } = cursorLine(state.text, state.cursor);
  const target = line + direction;
  if (target >= 0 && target < lines.length) {
    return { ...state, cursor: offsetAtColumn(state.text, target, column) };
  }
  return direction < 0 ? historyPrevious(state) : historyNext(state);
}

function cursorLine(text: string, cursor: number): { line: number; column: number } {
  const start = lineStart(text, cursor);
  const line = text.slice(0, start).split("\n").length - 1;
  return { line, column: displayWidth(text.slice(start, cursor)) };
}

function offsetAtColumn(text: string, line: number, column: number): number {
  const lines = text.split("\n");
  const target = lines[line] ?? "";
  let start = 0;
  for (let i = 0; i < line; i++) start += (lines[i]?.length ?? 0) + 1;
  let used = 0;
  let offset = start;
  while (offset < start + target.length && used < column) {
    const next = nextBound(text, offset);
    used += displayWidth(text.slice(offset, next));
    offset = next;
  }
  return offset;
}

function historyPrevious(state: EditorState): EditorState {
  if (state.history.length === 0 || state.historyAt === 0) return state;
  const historyAt = Math.min(state.historyAt, state.history.length) - 1;
  const draft = state.historyAt >= state.history.length ? state.text : state.draft;
  const text = state.history[historyAt] ?? "";
  return { ...state, text, cursor: text.length, historyAt, draft };
}

function historyNext(state: EditorState): EditorState {
  if (state.historyAt >= state.history.length) return state;
  const historyAt = state.historyAt + 1;
  if (historyAt >= state.history.length) {
    return { ...state, text: state.draft, cursor: state.draft.length, historyAt };
  }
  const text = state.history[historyAt] ?? "";
  return { ...state, text, cursor: text.length, historyAt };
}
