import { describe, expect, it } from "vitest";
import { foldToolOutput, toolOutputFoldable } from "./tool-fold.js";

describe("foldToolOutput", () => {
  it("leaves short single-line bodies alone when collapsed", () => {
    expect(foldToolOutput("ok", false)).toBe("ok");
    expect(toolOutputFoldable("ok")).toBe(false);
  });

  it("collapses multi-line bodies to a one-line summary", () => {
    const folded = foldToolOutput("apps\npackages\nREADME.md", false);
    expect(folded).toContain("apps");
    expect(folded).toContain("3 lines");
    expect(folded).toContain("Ctrl+O");
    expect(folded).not.toContain("\n");
    expect(toolOutputFoldable("apps\npackages\nREADME.md")).toBe(true);
  });

  it("returns the full body when expanded", () => {
    const body = "apps\npackages\nREADME.md";
    expect(foldToolOutput(body, true)).toBe(body);
  });

  it("collapses a long single line", () => {
    const long = "x".repeat(120);
    const folded = foldToolOutput(long, false);
    expect(folded.length).toBeLessThan(long.length);
    expect(folded).toContain("Ctrl+O");
  });
});
