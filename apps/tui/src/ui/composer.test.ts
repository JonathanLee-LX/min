import { describe, expect, it } from "vitest";
import {
  COMPOSER_MIN_ROWS,
  composerContentRowCount,
  composerContentRows,
  composerPadTop,
} from "./Composer.js";

describe("composerContentRows", () => {
  it("vertically centers a single line in the min-height box", () => {
    expect(COMPOSER_MIN_ROWS).toBe(3);
    expect(composerPadTop(1)).toBe(1);
    expect(composerContentRows("", 40)).toEqual(["", "", ""]);
    // Equal blank padding above and below the text.
    expect(composerContentRows("hi", 40)).toEqual(["", "hi", ""]);
    expect(composerContentRowCount("hi", 40)).toBe(3);
  });

  it("grows for soft wraps and hard newlines without extra pad", () => {
    expect(composerPadTop(3)).toBe(0);
    expect(composerContentRows("abcdefgh", 4)).toEqual(["abcd", "efgh", ""]);
    expect(composerContentRows("a\nb\nc", 40)).toEqual(["a", "b", "c"]);
    expect(composerContentRowCount("a\nb\nc", 40)).toBe(3);
    expect(composerContentRows("a\nb\nc\nd", 40)).toEqual(["a", "b", "c", "d"]);
  });
});
