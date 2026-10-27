import { describe, expect, it } from "vitest";
import { minBannerLines, minBannerRows } from "./banner.js";
import { displayWidth } from "./text.js";

describe("minBanner", () => {
  it("uses a compact mark when no glyph fits", () => {
    expect(minBannerLines(4)).toEqual(["MIN"]);
    expect(minBannerRows(4)).toBe(1);
  });

  it("renders a mid-size MIN glyph without an agent tag", () => {
    const lines = minBannerLines(20);
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(lines.join("\n")).not.toMatch(/agent/i);
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(20);
    }
  });

  it("renders the full artistic MIN glyph when wide enough", () => {
    const lines = minBannerLines(40);
    expect(lines).toHaveLength(6);
    expect(lines.some((line) => line.includes("███╗"))).toBe(true);
    expect(lines.join("\n")).not.toMatch(/agent/i);
    expect(minBannerRows(40)).toBe(6);
  });
});
