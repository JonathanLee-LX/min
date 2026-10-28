import { describe, expect, it } from "vitest";
import {
  COMPOSER_MIN_ROWS,
  COMPOSER_PADDING_Y,
  composerBodyRowCount,
  composerContentRowCount,
  composerContentRows,
  composerPadTop,
  composerPaddingRows,
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
});
