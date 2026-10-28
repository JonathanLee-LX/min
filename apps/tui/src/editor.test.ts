import { describe, expect, it } from "vitest";
import {
  commitEditor,
  createEditor,
  editorCaret,
  inputAction,
  reduceEditor,
  type EditorState,
  type InputKey,
} from "./editor.js";

function key(partial: Partial<InputKey> = {}): InputKey {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...partial,
  };
}

function type(state: EditorState, text: string): EditorState {
  return reduceEditor(state, { op: "insert", text });
}

describe("editor", () => {
  it("inserts at the cursor and deletes one grapheme", () => {
    let state = type(createEditor(), "你好");
    state = reduceEditor(state, { op: "backspace" });
    expect(state.text).toBe("你");
    state = reduceEditor(state, { op: "left" });
    state = type(state, "x");
    expect(state.text).toBe("x你");
    expect(state.cursor).toBe(1);
  });

  it("backspaces a combining character and a ZWJ emoji in one key", () => {
    let combining = type(createEditor(), "e\u0301!");
    combining = reduceEditor(combining, { op: "left" });
    combining = reduceEditor(combining, { op: "backspace" });
    expect(combining.text).toBe("!");

    const family = "👨‍👩‍👧";
    let emoji = type(createEditor(), `a${family}`);
    emoji = reduceEditor(emoji, { op: "backspace" });
    expect(emoji.text).toBe("a");
    emoji = type(createEditor(), family);
    emoji = reduceEditor(emoji, { op: "left" });
    expect(emoji.cursor).toBe(0);
  });

  it("normalizes pasted newlines and keeps the caret on a grapheme", () => {
    const state = type(createEditor(), "line1\r\nline2");
    expect(state.text).toBe("line1\nline2");
    expect(editorCaret(state)).toEqual({ before: "line1\nline2", caret: " ", after: "" });
  });

  it("moves within a wrapped draft before walking history", () => {
    let state = type(createEditor(), "ab");
    state = reduceEditor(state, { op: "newline" });
    state = type(state, "cd");
    state = reduceEditor(state, { op: "up" });
    expect(state.text).toBe("ab\ncd");
    expect(state.cursor).toBe(2);
  });

  it("recalls history and restores the draft", () => {
    let state = commitEditor(type(createEditor(), "one")).state;
    state = commitEditor(type(state, "two")).state;
    state = type(state, "draft");
    state = reduceEditor(state, { op: "up" });
    expect(state.text).toBe("two");
    state = reduceEditor(state, { op: "up" });
    expect(state.text).toBe("one");
    state = reduceEditor(state, { op: "down" });
    expect(state.text).toBe("two");
    state = reduceEditor(state, { op: "down" });
    expect(state.text).toBe("draft");
  });

  it("does not store a duplicate or a blank commit", () => {
    let state = commitEditor(type(createEditor(), "one")).state;
    state = commitEditor(type(state, "one")).state;
    expect(state.history).toEqual(["one"]);
    state = commitEditor(type(state, "   ")).state;
    expect(state.history).toEqual(["one"]);
  });

  it("deletes the previous word and the line prefix", () => {
    let state = type(createEditor(), "hello world");
    state = reduceEditor(state, { op: "backspaceWord" });
    expect(state.text).toBe("hello ");
    state = type(createEditor(), "ab\ncd");
    state = reduceEditor(state, { op: "killLineStart" });
    expect(state.text).toBe("ab\n");
  });
});

describe("inputAction", () => {
  it("maps editing, newline, scroll, and interrupt keys", () => {
    expect(inputAction("你", key())).toEqual({ type: "edit", op: { op: "insert", text: "你" } });
    expect(inputAction("line1\nline2", key()).type).toBe("edit");
    expect(inputAction("", key({ return: true, meta: true }))).toEqual({
      type: "edit",
      op: { op: "newline" },
    });
    expect(inputAction("j", key({ ctrl: true }))).toEqual({
      type: "edit",
      op: { op: "newline" },
    });
    expect(inputAction("", key({ return: true, shift: true }))).toEqual({
      type: "edit",
      op: { op: "newline" },
    });
    // Plain Enter inserts a newline when the draft does not already end with one.
    expect(inputAction("", key({ return: true }), { text: "hello", cursor: 5 })).toEqual({
      type: "edit",
      op: { op: "newline" },
    });
    // Double-Enter submits once the draft ends with a newline.
    expect(inputAction("", key({ return: true }), { text: "hello\n", cursor: 6 })).toEqual({
      type: "submit",
    });
    // Ctrl+Enter always submits.
    expect(inputAction("", key({ return: true, ctrl: true }), { text: "hello", cursor: 5 })).toEqual({
      type: "submit",
    });
    expect(inputAction("", key({ pageUp: true }))).toEqual({ type: "scroll", direction: "up" });
    expect(inputAction("", key({ pageDown: true }))).toEqual({ type: "scroll", direction: "down" });
    expect(inputAction("c", key({ ctrl: true }))).toEqual({ type: "interrupt" });
    expect(inputAction("", key({ escape: true }))).toEqual({ type: "interrupt" });
    expect(inputAction("o", key({ ctrl: true }))).toEqual({ type: "toggle-tool-output" });
    expect(inputAction("w", key({ ctrl: true }))).toEqual({
      type: "edit",
      op: { op: "backspaceWord" },
    });
    expect(inputAction("u", key({ ctrl: true }))).toEqual({
      type: "edit",
      op: { op: "killLineStart" },
    });
    expect(inputAction("a", key({ ctrl: true }))).toEqual({ type: "edit", op: { op: "home" } });
    expect(inputAction("e", key({ ctrl: true }))).toEqual({ type: "edit", op: { op: "end" } });
  });
});
