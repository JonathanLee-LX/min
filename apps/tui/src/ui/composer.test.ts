import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink";
import { PassThrough } from "node:stream";
import {
  Composer,
  COMPOSER_MIN_ROWS,
  COMPOSER_PADDING_Y,
  composerBodyRowCount,
  composerContentRowCount,
  composerContentRows,
  composerPadTop,
  composerPaddingRows,
  composerLinesWithCursor,
} from "./Composer.js";

describe("composerContentRows", () => {
  it("keeps content at one row; 0.5 padding floors to 0 blank rows", () => {
    expect(COMPOSER_MIN_ROWS).toBe(1);
    expect(COMPOSER_PADDING_Y).toBe(0.5);
    expect(composerPaddingRows()).toBe(0);
    expect(composerPadTop()).toBe(0);
    expect(composerContentRows("", 40)).toEqual([""]);
    expect(composerContentRows("hi", 40)).toEqual(["hi"]);
    expect(composerContentRowCount("hi", 40)).toBe(1);
    expect(composerBodyRowCount("hi", 40)).toBe(1);
    expect(composerBodyRowCount("", 40)).toBe(1);
  });

  it("grows content for soft wraps and hard newlines", () => {
    expect(composerContentRows("abcdefgh", 4)).toEqual(["abcd", "efgh"]);
    expect(composerBodyRowCount("abcdefgh", 4)).toBe(2);
    expect(composerContentRows("a\nb\nc", 40)).toEqual(["a", "b", "c"]);
    expect(composerBodyRowCount("a\nb\nc", 40)).toBe(3);
  });

  it("calculates lines and cursor fragments for single and multi-line drafts", () => {
    // Empty draft
    expect(composerLinesWithCursor("", 0, 40)).toEqual([
      { before: "", caret: " ", after: "" },
    ]);

    // Single line at end
    expect(composerLinesWithCursor("hello", 5, 40)).toEqual([
      { before: "hello", caret: " ", after: "" },
    ]);

    // Chinese text
    expect(composerLinesWithCursor("你好", 2, 40)).toEqual([
      { before: "你好", caret: " ", after: "" },
    ]);

    // Single line mid cursor
    expect(composerLinesWithCursor("hello", 2, 40)).toEqual([
      { before: "he", caret: "l", after: "lo" },
    ]);

    // Multi line cursor on second line
    expect(composerLinesWithCursor("hello\nworld", 7, 40)).toEqual([
      { before: "hello", after: "" },
      { before: "w", caret: "o", after: "rld" },
    ]);
  });

  it("renders Chinese text in Composer on initial empty-to-text transition", async () => {
    const stream = new PassThrough();
    (stream as any).isTTY = true;
    (stream as any).columns = 80;
    (stream as any).rows = 24;
    let output = "";
    stream.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });

    const instance = render(
      React.createElement(Composer, {
        text: "",
        cursor: 0,
        columns: 78,
        color: "#4e9a57",
        borderColor: "#4e9a57",
      }),
      { stdout: stream as unknown as NodeJS.WriteStream }
    );

    // Transition from empty text (initial state) to Chinese input (first keystroke)
    output = "";
    instance.rerender(
      React.createElement(Composer, {
        text: "你好",
        cursor: 2,
        columns: 78,
        color: "#4e9a57",
        borderColor: "#4e9a57",
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(output).toContain("你好");
    instance.unmount();
  });
});
