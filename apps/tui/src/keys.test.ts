import { describe, expect, it } from "vitest";
import { actionFromChunk } from "./keys.js";

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
    expect(actionFromChunk("\x03")).toEqual({ type: "interrupt" });
    expect(actionFromChunk("\x0f")).toEqual({ type: "toggle-tool-output" });
    expect(actionFromChunk("你好")).toEqual({ type: "edit", op: { op: "insert", text: "你好" } });
    expect(actionFromChunk("\x1b[200~line\r\nnext\x1b[201~")).toEqual({
      type: "edit",
      op: { op: "insert", text: "line\r\nnext" },
    });
  });
});