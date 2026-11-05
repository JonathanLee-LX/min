import { describe, expect, it } from "vitest";
import {
  COMPACT_SCALE,
  densityChromeWidth,
  densityListVisible,
  densityPaddingX,
  parseUiDensity,
  scaleCount,
  toggleDensity,
} from "./density.js";
import { CONTENT_SIDE_GAP, gapBefore, SESSION_GAP, SIDE_BLOCK_GAP } from "./paint.js";

describe("density", () => {
  it("parses compact and comfortable names", () => {
    expect(parseUiDensity("compact")).toBe("compact");
    expect(parseUiDensity("comfortable")).toBe("comfortable");
    expect(parseUiDensity("default")).toBe("comfortable");
    expect(parseUiDensity("normal")).toBe("comfortable");
    expect(parseUiDensity("wide")).toBeUndefined();
    expect(toggleDensity("compact")).toBe("comfortable");
    expect(toggleDensity("comfortable")).toBe("compact");
  });

  it("shrinks comfortable 1/2/3 row gaps to 0.8 floored cells", () => {
    expect(COMPACT_SCALE).toBe(0.8);
    expect(scaleCount(SIDE_BLOCK_GAP, "compact")).toBe(0);
    expect(scaleCount(CONTENT_SIDE_GAP, "compact")).toBe(1);
    expect(scaleCount(SESSION_GAP, "compact")).toBe(2);
    expect(gapBefore("thinking", "tool", "compact")).toBe(0);
    expect(gapBefore("user", "thinking", "compact")).toBe(1);
    expect(gapBefore("assistant", "user", "compact")).toBe(2);
    expect(gapBefore("tool", "tool-result", "compact")).toBe(0);
    expect(densityPaddingX("compact")).toBe(0);
    expect(densityPaddingX("comfortable")).toBe(1);
    expect(densityListVisible("compact")).toBe(6);
    expect(densityChromeWidth(5, "compact")).toBe(4);
  });
});
