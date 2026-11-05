import { describe, expect, it } from "vitest";
import { formatModelLine, layoutModelRows } from "./model-brief.js";
import { displayWidth } from "./text.js";

function columnStart(row: { mark: string; name: string; detail: string }): number {
  return displayWidth(row.mark) + displayWidth(row.name);
}

describe("model rows", () => {
  it("aligns the name and detail across rows", () => {
    const rows = layoutModelRows(
      [
        { name: "deepseek-flash", detail: "thinking", current: true },
        { name: "o3", detail: "thinking" },
        { name: "acme", detail: "openai gpt" },
      ],
      48,
    );
    expect(rows[0]!.mark).toBe("* ");
    expect(rows[1]!.mark).toBe("  ");
    expect(rows[0]!.name.trimEnd()).toBe("deepseek-flash");
    expect(rows[2]!.name.trimEnd()).toBe("acme");
    expect(displayWidth(rows[0]!.name)).toBe(displayWidth(rows[1]!.name));
    expect(displayWidth(rows[0]!.detail)).toBe(displayWidth(rows[2]!.detail));
    expect(columnStart(rows[0]!)).toBe(columnStart(rows[2]!));
    expect(rows[0]!.detail).toContain("thinking");
    expect(rows[2]!.detail).toContain("openai gpt");
    expect(displayWidth(formatModelLine(rows[0]!))).toBeLessThanOrEqual(48);
  });

  it("clips the name before the detail on a narrow row", () => {
    const rows = layoutModelRows(
      [{ name: "a-very-long-custom-model-identifier", detail: "thinking" }],
      24,
    );
    expect(rows[0]!.name.endsWith("…")).toBe(true);
    expect(rows[0]!.detail).toContain("thinking");
    expect(displayWidth(formatModelLine(rows[0]!))).toBeLessThanOrEqual(24);
  });
});
