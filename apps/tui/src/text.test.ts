import { describe, expect, it } from "vitest";
import { displayWidth, graphemeBounds, nextBound, previousBound, wrapText, wrappedRows } from "./text.js";

describe("graphemes", () => {
  it("treats CJK characters as one grapheme", () => {
    expect(graphemeBounds("你好")).toEqual([0, 1, 2]);
    expect(previousBound("你好", 2)).toBe(1);
    expect(nextBound("你好", 0)).toBe(1);
  });

  it("keeps a combining mark with its base", () => {
    const text = "e\u0301";
    expect(graphemeBounds(text)).toEqual([0, text.length]);
    expect(previousBound(text, text.length)).toBe(0);
  });

  it("keeps a ZWJ family emoji together", () => {
    const family = "👨‍👩‍👧";
    expect(family.length).toBeGreaterThan(2);
    expect(graphemeBounds(family)).toEqual([0, family.length]);
  });
});

describe("display width", () => {
  it("counts CJK as two cells and combining marks as zero", () => {
    expect(displayWidth("a")).toBe(1);
    expect(displayWidth("你")).toBe(2);
    expect(displayWidth("e\u0301")).toBe(1);
    expect(displayWidth("😀")).toBe(2);
  });

  it("wraps wide characters onto the next row", () => {
    expect(wrapText("你好你好你好", 4)).toEqual(["你好", "你好", "你好"]);
    expect(wrappedRows("a\n\n你", 4)).toBe(3);
  });
});
