import { describe, expect, it } from "vitest";
import { minBannerLines, minBannerRows } from "./banner.js";
import { displayWidth } from "./text.js";

describe("minBanner", () => {
  it("uses a compact mark when the glyph does not fit", () => {
    expect(minBannerLines(4)).toEqual(["MIN"]);
    expect(minBannerRows(4)).toBe(1);
  });

  it("renders a three-row MIN glyph that fits its own width", () => {
    const lines = minBannerLines(12);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("╔╦╗");
    expect(lines.join("\n")).toMatch(/╦/);
    for (const line of lines) {
      expect(displayWidth(line)).toBeLessThanOrEqual(12);
    }
    expect(minBannerRows(12)).toBe(3);
  });

  it("adds an agent tag when there is room beside the glyph", () => {
    const lines = minBannerLines(40);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("agent");
    expect(lines.some((line) => line.includes("╔╦╗"))).toBe(true);
  });
});
