import { describe, expect, it } from "vitest";
import { applyImeCursor, composerCaretAnchor } from "./ime-cursor.js";

describe("composerCaretAnchor", () => {
  it("places the caret on the single content row when padding floors to 0", () => {
    expect(
      composerCaretAnchor({
        paddingX: 1,
        chatBar: "▌ ",
        text: "",
        cursor: 0,
        columns: 40,
        inputRows: 1,
        rowsAboveComposer: 10,
        rowsBelowComposer: 1,
      }),
    ).toEqual({ column: 3, rowFromTop: 10, rowsBelowCaret: 1 });
  });

  it("accounts for wide CJK cells", () => {
    expect(
      composerCaretAnchor({
        paddingX: 1,
        chatBar: "> ",
        text: "你好",
        cursor: 1,
        columns: 40,
        inputRows: 1,
        rowsAboveComposer: 5,
        rowsBelowComposer: 0,
      }),
    ).toEqual({ column: 1 + 2 + 2, rowFromTop: 5, rowsBelowCaret: 0 });
  });

  it("follows soft-wrapped rows", () => {
    expect(
      composerCaretAnchor({
        paddingX: 1,
        chatBar: "",
        text: "abcdefgh",
        cursor: 5,
        columns: 4,
        inputRows: 2,
        rowsAboveComposer: 2,
        rowsBelowComposer: 0,
      }),
    ).toEqual({ column: 1 + 1, rowFromTop: 3, rowsBelowCaret: 0 });
  });
});

describe("applyImeCursor", () => {
  it("uses CUP for clearTerminal paints", () => {
    const chunks: string[] = [];
    applyImeCursor(
      (chunk) => chunks.push(chunk),
      { column: 4, rowFromTop: 12, rowsBelowCaret: 2 },
      80,
      "absolute",
    );
    expect(chunks.join("")).toBe("\x1b[?25h\x1b[13;5H");
  });

  it("climbs from below the frame for eraseLines paints", () => {
    const chunks: string[] = [];
    applyImeCursor(
      (chunk) => chunks.push(chunk),
      { column: 4, rowFromTop: 12, rowsBelowCaret: 2 },
      80,
      "relative",
    );
    expect(chunks.join("")).toBe("\x1b[?25h\x1b[3A\x1b[5G");
  });

  it("parks empty-composer caret above the bottom chrome", () => {
    // After Enter the draft is empty; rowsBelow includes bottom rule + status.
    const anchor = composerCaretAnchor({
      paddingX: 1,
      chatBar: "",
      text: "",
      cursor: 0,
      columns: 80,
      inputRows: 1,
      rowsAboveComposer: 20,
      rowsBelowComposer: 2,
    });
    expect(anchor).toEqual({ column: 1, rowFromTop: 20, rowsBelowCaret: 2 });
    const chunks: string[] = [];
    applyImeCursor((chunk) => chunks.push(chunk), anchor, 80, "relative");
    // Climb past log-update's trailing newline + bottom chrome onto the body.
    expect(chunks.join("")).toBe("\x1b[?25h\x1b[3A\x1b[2G");
  });
});
