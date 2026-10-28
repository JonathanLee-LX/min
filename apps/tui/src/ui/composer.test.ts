import { describe, expect, it } from "vitest";
import {
  COMPOSER_MIN_ROWS,
  composerContentRowCount,
  composerContentRows,
  composerPadTop,
} from "./Composer.js";

describe("composerContentRows", () => {
  it("keeps a 2× line-height box and pads a single line off the top rule", () => {
    expect(COMPOSER_MIN_ROWS).toBe(2);
    expect(composerPadTop(1)).toBe(1);
    expect(composerContentRows("", 40)).toEqual(["", ""]);
    expect(composerContentRows("hi", 40)).toEqual(["", "hi"]);
    expect(composerContentRowCount("hi", 40)).toBe(2);
  });

  it("grows for soft wraps and hard newlines without extra pad", () => {
    expect(composerPadTop(2)).toBe(0);
    expect(composerContentRows("abcdefgh", 4)).toEqual(["abcd", "efgh"]);
    expect(composerContentRows("a\nb\nc", 40)).toEqual(["a", "b", "c"]);
    expect(composerContentRowCount("a\nb\nc", 40)).toBe(3);
  });
});
