import { describe, expect, it } from "vitest";
import {
  applyImeCursor,
  composerCaretAnchor,
  installImeCursorHook,
  rewriteEraseLinesFrame,
  SYNC_BEGIN,
  SYNC_END,
} from "./ime-cursor.js";

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

describe("rewriteEraseLinesFrame", () => {
  it("overwrites rows in place instead of wiping them first", () => {
    const wiped = "\x1b[2K\x1b[1A\x1b[2K\x1b[Ghello\n";
    expect(rewriteEraseLinesFrame(wiped)).toBe("\x1b[1A\x1b[Ghello\x1b[K\n\x1b[K");
  });

  it("clears rows the new frame no longer uses", () => {
    const wiped = "\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[Gone\n";
    expect(rewriteEraseLinesFrame(wiped)).toBe(
      "\x1b[2A\x1b[Gone\x1b[K\n\x1b[K\n\x1b[K\x1b[1A",
    );
  });

  it("leaves clearTerminal writes alone", () => {
    expect(rewriteEraseLinesFrame("\x1b[2J\x1b[Hhello\n")).toBeNull();
  });
});

describe("installImeCursorHook", () => {
  it("ships the frame and caret in one synchronized write", () => {
    const writes: string[] = [];
    const stdout = {
      isTTY: true,
      write(chunk: string) {
        writes.push(String(chunk));
        return true;
      },
    } as NodeJS.WriteStream;
    const restore = installImeCursorHook(
      stdout,
      () => ({ column: 1, rowFromTop: 20, rowsBelowCaret: 2 }),
      () => 80,
    );
    const frame = "\x1b[2K\x1b[1A\x1b[2K\x1b[Ghello\n";
    stdout.write(frame);
    stdout.write(frame);
    stdout.write("plain");

    expect(writes).toHaveLength(3);
    expect(writes[2]).toBe("plain");
    expect(writes[0]).toBe(
      `${SYNC_BEGIN}\x1b[1A\x1b[Ghello\x1b[K\n\x1b[K\x1b[?25h\x1b[3A\x1b[2G${SYNC_END}`,
    );
    // Next frame starts from the parked caret, so it steps back to the
    // trailing row before overwriting. Same caret park either way.
    expect(writes[1]).toBe(
      `${SYNC_BEGIN}\x1b[3B\x1b[1A\x1b[Ghello\x1b[K\n\x1b[K\x1b[?25h\x1b[3A\x1b[2G${SYNC_END}`,
    );
    restore();
    expect(writes.at(-1)).toBe("\x1b[?25l");
  });
});
