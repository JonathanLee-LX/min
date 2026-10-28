import { clearTerminal, eraseLines } from "ansi-escapes";
import { describe, expect, it } from "vitest";
import {
  applyImeCursor,
  composerCaretAnchor,
  installImeCursorHook,
  rewriteEraseLinesFrame,
  type ImeCaretAnchor,
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

/**
 * Flicker regression. Ink's log-update clears every previous row with CSI 2K
 * before drawing the next frame. Terminals paint that wipe immediately, so
 * stream and spinner ticks flash. These cases feed ansi-escapes' own
 * `eraseLines` (the bytes Ink writes) through the hook.
 */
describe("paint flicker regression", () => {
  it("does not full-line-wipe successive log-update frames", () => {
    const writes: string[] = [];
    const stdout = captureStdout(writes);
    const restore = installImeCursorHook(stdout, () => caret(2), () => 80);

    let lineCount = 0;
    const sent: string[] = [];
    for (const frame of ["hi", "hello", "hello!"]) {
      const next = logUpdateChunk(lineCount, frame);
      lineCount = next.lineCount;
      sent.push(next.chunk);
      stdout.write(next.chunk);
    }
    restore();

    // Nothing to erase on the first paint, so the hook leaves it alone.
    expect(sent[0]).toBe("hi\n");
    expect(writes[0]).toBe("hi\n");
    expect(sent[1]).toContain("\x1b[2K");
    expect(sent[2]).toContain("\x1b[2K");
    expectStablePaint(writes[1] ?? "", "hello");
    expectStablePaint(writes[2] ?? "", "hello!");
  });

  it("drops a shorter row without wiping the frame", () => {
    const writes: string[] = [];
    const stdout = captureStdout(writes);
    const restore = installImeCursorHook(stdout, () => caret(2), () => 80);

    const first = logUpdateChunk(0, "hello world");
    stdout.write(first.chunk);
    const second = logUpdateChunk(first.lineCount, "hi");
    stdout.write(second.chunk);
    restore();

    expect(second.chunk).toContain("\x1b[2K");
    expectStablePaint(writes[1] ?? "", "hi");
    expect(writes[1]).toContain("\x1b[K");
  });

  it("parks the caret in the same write after the composer collapses", () => {
    let rowsBelow = 8;
    const writes: string[] = [];
    const stdout = captureStdout(writes);
    const restore = installImeCursorHook(
      stdout,
      () => caret(rowsBelow),
      () => 80,
    );

    const opened = logUpdateChunk(0, "/resume");
    stdout.write(opened.chunk);
    const menu = logUpdateChunk(opened.lineCount, "/resume");
    stdout.write(menu.chunk);
    rowsBelow = 2;
    const submitted = logUpdateChunk(menu.lineCount, "");
    stdout.write(submitted.chunk);
    restore();

    expect(menu.chunk).toContain("\x1b[2K");
    expect(submitted.chunk).toContain("\x1b[2K");
    expectStablePaint(writes[1] ?? "", "/resume");
    expect(writes[1]).toContain("\x1b[?25h\x1b[9A\x1b[2G");
    expectStablePaint(writes[2] ?? "", "");
    // Empty composer: climb past the trailing newline and the two chrome rows.
    expect(writes[2]).toContain("\x1b[?25h\x1b[3A\x1b[2G");
    expect(writes[2]?.startsWith(`${SYNC_BEGIN}\x1b[9B`)).toBe(true);
  });

  it("keeps a hard clear and the caret in one write", () => {
    const writes: string[] = [];
    const stdout = captureStdout(writes);
    const restore = installImeCursorHook(stdout, () => caret(2), () => 80);
    stdout.write(`${clearTerminal}hello\n`);
    restore();

    expect(writes[0]?.startsWith(SYNC_BEGIN)).toBe(true);
    expect(writes[0]?.endsWith(SYNC_END)).toBe(true);
    expect(writes[0]).toContain(clearTerminal);
    expect(writes[0]).toContain("hello");
    expect(writes[0]).toContain("\x1b[?25h\x1b[21;2H");
    expect(writes[0]?.indexOf("\x1b[?25h")).toBeLessThan(writes[0]?.lastIndexOf(SYNC_END) ?? -1);
  });
});

/** Ink log-update: erase the previous frame, then write `frame` plus a newline. */
function logUpdateChunk(
  previousLineCount: number,
  frame: string,
): { chunk: string; lineCount: number } {
  const output = `${frame}\n`;
  return {
    chunk: eraseLines(previousLineCount) + output,
    lineCount: output.split("\n").length,
  };
}

function caret(rowsBelowCaret: number): ImeCaretAnchor {
  return { column: 1, rowFromTop: 20, rowsBelowCaret };
}

function captureStdout(writes: string[]): NodeJS.WriteStream {
  return {
    isTTY: true,
    write(chunk: string) {
      writes.push(String(chunk));
      return true;
    },
  } as NodeJS.WriteStream;
}

/** A finished paint: one synchronized write, no CSI 2K wipe, caret inside it. */
function expectStablePaint(write: string, text: string): void {
  expect(write.startsWith(SYNC_BEGIN)).toBe(true);
  expect(write.endsWith(SYNC_END)).toBe(true);
  expect(write).not.toContain("\x1b[2K");
  if (text) expect(write).toContain(text);
  const caretAt = write.indexOf("\x1b[?25h");
  expect(caretAt).toBeGreaterThan(SYNC_BEGIN.length);
  expect(caretAt).toBeLessThan(write.lastIndexOf(SYNC_END));
}
