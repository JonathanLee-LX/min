import { describe, expect, it } from "vitest";
import { layoutViewport, linesFromMessages } from "./transcript.js";

describe("linesFromMessages", () => {
  it("skips system text and keeps user text intact", () => {
    const text = "你".repeat(40);
    const lines = linesFromMessages([
      { role: "system", content: [{ type: "text", text: "hidden" }] },
      { role: "user", content: [{ type: "text", text }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "ok" },
          { type: "tool_call", name: "read_file", arguments: { path: "a.ts" } },
        ],
      },
      {
        role: "tool",
        content: [{ type: "tool_result", content: "x".repeat(1200), isError: true }],
      },
    ]);
    expect(lines.map((line) => line.kind)).toEqual(["user", "assistant", "tool", "tool-error"]);
    expect(lines[0]?.text).toBe(text);
    expect(lines[2]?.text).toBe("read_file  a.ts");
    expect(lines[3]?.text.endsWith("...")).toBe(true);
    expect(lines[3]!.text.length).toBeLessThanOrEqual(1000);
  });
});

describe("layoutViewport", () => {
  it("pins to the bottom and scrolls by visual rows", () => {
    const lines = Array.from({ length: 10 }, (_, index) => ({ text: `row ${index}` }));
    const pinned = layoutViewport(lines, 80, 3, 0);
    expect(pinned.visible.map((row) => row.text)).toEqual(["row 7", "row 8", "row 9"]);
    expect(pinned.hiddenAbove).toBe(7);
    expect(pinned.hiddenBelow).toBe(0);

    const scrolled = layoutViewport(lines, 80, 3, 4);
    expect(scrolled.visible.map((row) => row.text)).toEqual(["row 3", "row 4", "row 5"]);
    expect(scrolled.hiddenAbove).toBe(3);
    expect(scrolled.hiddenBelow).toBe(4);
  });

  it("scrolls inside a wrapped message", () => {
    const layout = layoutViewport([{ text: "你好你好你好" }], 4, 2, 0);
    expect(layout.total).toBe(3);
    expect(layout.visible.map((row) => row.text)).toEqual(["你好", "你好"]);
    expect(layout.hiddenAbove).toBe(1);
    const older = layoutViewport([{ text: "你好你好你好" }], 4, 2, 1);
    expect(older.visible.map((row) => row.text)).toEqual(["你好", "你好"]);
    expect(older.hiddenAbove).toBe(0);
    expect(older.hiddenBelow).toBe(1);
  });

  it("clamps scroll past either end", () => {
    const layout = layoutViewport([{ text: "only" }], 80, 5, 9);
    expect(layout.visible.map((row) => row.text)).toEqual(["only"]);
    expect(layout.scroll).toBe(0);
  });
});
