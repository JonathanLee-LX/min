import { describe, expect, it } from "vitest";
import { composerCaretScreenPos } from "./ime-cursor.js";

describe("composerCaretScreenPos", () => {
  it("anchors at the chat bar when the draft is empty", () => {
    expect(
      composerCaretScreenPos({
        paddingX: 1,
        rowsAboveComposer: 10,
        chatBar: "▌ ",
        text: "",
        cursor: 0,
      }),
    ).toEqual({ x: 3, y: 10 });
  });

  it("accounts for wide CJK cells on the caret line", () => {
    // "你" is one UTF-16 unit and two terminal cells.
    expect(
      composerCaretScreenPos({
        paddingX: 1,
        rowsAboveComposer: 5,
        chatBar: "> ",
        text: "你好",
        cursor: 1,
      }),
    ).toEqual({ x: 1 + 2 + 2, y: 5 });
  });

  it("moves down for newline caret rows", () => {
    expect(
      composerCaretScreenPos({
        paddingX: 0,
        rowsAboveComposer: 3,
        chatBar: "",
        text: "ab\ncd",
        cursor: 4,
      }),
    ).toEqual({ x: 1, y: 4 });
  });
});
