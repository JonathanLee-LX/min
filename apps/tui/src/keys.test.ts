import { describe, expect, it } from "vitest";
import { inputAction } from "./editor.js";
import { actionFromChunk, createInputDecoder } from "./keys.js";

describe("actionFromChunk", () => {
  it("treats the Backspace byte as a backward delete", () => {
    expect(actionFromChunk("\x7f")).toEqual({ type: "edit", op: { op: "backspace" } });
    expect(actionFromChunk("\b")).toEqual({ type: "edit", op: { op: "backspace" } });
    expect(actionFromChunk("\x1b[127u")).toEqual({ type: "edit", op: { op: "backspace" } });
  });

  it("keeps the forward Delete sequence distinct", () => {
    expect(actionFromChunk("\x1b[3~")).toEqual({ type: "edit", op: { op: "delete" } });
    expect(actionFromChunk("\x1b[3;5~")).toEqual({ type: "edit", op: { op: "delete" } });
  });

  it("still maps enter, arrows, page keys, and paste", () => {
    expect(actionFromChunk("\r")).toEqual({ type: "submit" });
    expect(actionFromChunk("\n")).toEqual({ type: "edit", op: { op: "newline" } });
    expect(actionFromChunk("\x1b\r")).toEqual({ type: "edit", op: { op: "newline" } });
    expect(actionFromChunk("\x1b[A")).toEqual({ type: "edit", op: { op: "up" } });
    expect(actionFromChunk("\x1b[D")).toEqual({ type: "edit", op: { op: "left" } });
    expect(actionFromChunk("\x1b[5~")).toEqual({ type: "scroll", direction: "up" });
    expect(actionFromChunk("\x1b[6~")).toEqual({ type: "scroll", direction: "down" });
    expect(actionFromChunk("\x1b[<64;12;8M")).toEqual({
      type: "scroll",
      direction: "up",
      delta: 3,
    });
    expect(actionFromChunk("\x1b[<65;12;8M")).toEqual({
      type: "scroll",
      direction: "down",
      delta: 3,
    });
    expect(actionFromChunk("\x1b[<0;12;8M")).toEqual({ type: "ignore" });
    expect(actionFromChunk("\x1b[<0;12;8m")).toEqual({ type: "ignore" });
    expect(actionFromChunk("\x03")).toEqual({ type: "interrupt" });
    expect(actionFromChunk("\x1b")).toEqual({ type: "interrupt" });
    expect(actionFromChunk("\x0f")).toEqual({ type: "toggle-tool-output" });
    expect(actionFromChunk("\x14")).toEqual({ type: "toggle-thinking" });
    expect(actionFromChunk("你好")).toEqual({ type: "edit", op: { op: "insert", text: "你好" } });
    expect(actionFromChunk("\x1b[200~line\r\nnext\x1b[201~")).toEqual({
      type: "edit",
      op: { op: "insert", text: "line\r\nnext" },
    });
  });

  it("maps Shift+Enter sequences to newline", () => {
    expect(actionFromChunk("\x1b[13;2u")).toEqual({ type: "edit", op: { op: "newline" } });
    expect(actionFromChunk("\x1b[27;2;13~")).toEqual({ type: "edit", op: { op: "newline" } });
  });

  it("maps modifyOtherKeys / kitty Ctrl+C to interrupt (not insert)", () => {
    expect(actionFromChunk("\x1b[27;5;99~")).toEqual({ type: "interrupt" });
    expect(actionFromChunk("\x1b[99;5u")).toEqual({ type: "interrupt" });
    expect(actionFromChunk("\x03")).toEqual({ type: "interrupt" });
  });

  it("swallows unknown CSI instead of inserting it as text", () => {
    expect(actionFromChunk("\x1b[999;5u")).toEqual({ type: "ignore" });
    expect(actionFromChunk("\x1b[27;5;1~")).toEqual({ type: "ignore" });
  });

  it("reassembles a PageUp sequence split by stdin", () => {
    const decoder = createInputDecoder();
    expect(decoder.push("\x1b")).toEqual([]);
    expect(decoder.push("[5")).toEqual([]);
    const [decoded] = decoder.push("~");
    expect(decoded).toBeDefined();
    expect(decoded && inputAction(decoded.input, decoded.key)).toEqual({
      type: "scroll",
      direction: "up",
    });
  });

  it("reassembles arrow sequences split by stdin", () => {
    const expected = [
      ["A", { type: "edit", op: { op: "up" } }],
      ["B", { type: "edit", op: { op: "down" } }],
      ["C", { type: "edit", op: { op: "right" } }],
      ["D", { type: "edit", op: { op: "left" } }],
    ] as const;

    for (const [finalByte, action] of expected) {
      const decoder = createInputDecoder();
      expect(decoder.push("\x1b[")).toEqual([]);
      const [decoded] = decoder.push(finalByte);
      expect(decoded && inputAction(decoded.input, decoded.key)).toEqual(action);
    }
  });

  it("keeps a bracketed paste together across stdin chunks", () => {
    const decoder = createInputDecoder();
    expect(decoder.push("\x1b[200~hello")).toEqual([]);
    const [decoded] = decoder.push("\nworld\x1b[201~");
    expect(decoded).toMatchObject({ input: "hello\nworld" });
    expect(decoded && inputAction(decoded.input, decoded.key)).toEqual({
      type: "edit",
      op: { op: "insert", text: "hello\nworld" },
    });
  });

  it("separates a batched return key from ordinary typed text", () => {
    const decoder = createInputDecoder();
    const actions = decoder.push("/help\r").map(({ input, key }) => inputAction(input, key));
    expect(actions).toEqual([
      { type: "edit", op: { op: "insert", text: "/help" } },
      { type: "submit" },
    ]);
  });
});
