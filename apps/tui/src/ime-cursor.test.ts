import { describe, expect, it } from "vitest";
import { applyImeCursor, composerCaretAnchor } from "./ime-cursor.js";

describe("composerCaretAnchor", () => {
  it("anchors at the chat bar when the draft is empty", () => {
    expect(
      composerCaretAnchor({
        paddingX: 1,
        chatBar: "▌ ",
        text: "",
        cursor: 0,
        inputRows: 2,
        rowsBelowComposer: 1,
      }),
    ).toEqual({ column: 3, rowsBelowCaret: 1 + 1 });
  });

  it("accounts for wide CJK cells on the caret line", () => {
    expect(
      composerCaretAnchor({
        paddingX: 1,
        chatBar: "> ",
        text: "你好",
        cursor: 1,
        inputRows: 2,
        rowsBelowComposer: 0,
      }),
    ).toEqual({ column: 1 + 2 + 2, rowsBelowCaret: 1 });
  });

  it("counts rows below the caret across newlines", () => {
    expect(
      composerCaretAnchor({
        paddingX: 0,
        chatBar: "",
        text: "ab\ncd",
        cursor: 4,
        inputRows: 2,
        rowsBelowComposer: 3,
      }),
    ).toEqual({ column: 1, rowsBelowCaret: 0 + 3 });
  });
});

describe("applyImeCursor", () => {
  it("climbs from below the Ink frame then sets the column", () => {
    const chunks: string[] = [];
    applyImeCursor((chunk) => chunks.push(chunk), { column: 4, rowsBelowCaret: 2 }, 80);
    expect(chunks.join("")).toBe("\x1b[?25h\x1b[3A\x1b[5G");
  });
});
