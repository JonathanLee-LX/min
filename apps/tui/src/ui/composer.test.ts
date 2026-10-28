import { describe, expect, it } from "vitest";
import { COMPOSER_MIN_ROWS, composerContentRowCount, composerContentRows } from "./Composer.js";

describe("composerContentRows", () => {
  it("pads a single line up to 2× line height", () => {
    expect(COMPOSER_MIN_ROWS).toBe(2);
    expect(composerContentRows("", 40)).toEqual(["", ""]);
    expect(composerContentRows("hi", 40)).toEqual(["hi", ""]);
    expect(composerContentRowCount("hi", 40)).toBe(2);
  });

  it("grows for soft wraps and hard newlines", () => {
    expect(composerContentRows("abcdefgh", 4)).toEqual(["abcd", "efgh"]);
    expect(composerContentRows("a\nb\nc", 40)).toEqual(["a", "b", "c"]);
    expect(composerContentRowCount("a\nb\nc", 40)).toBe(3);
  });
});
