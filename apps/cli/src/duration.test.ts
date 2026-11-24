import { describe, expect, it, vi } from "vitest";
import { formatToolDuration } from "./duration.js";
import { createEventPrinter } from "./events.js";

describe("formatToolDuration", () => {
  it("keeps short runs visible and uses clear units", () => {
    expect(formatToolDuration(0)).toBe("0ms");
    expect(formatToolDuration(0.4)).toBe("<1ms");
    expect(formatToolDuration(12)).toBe("12ms");
    expect(formatToolDuration(400)).toBe("400ms");
    expect(formatToolDuration(400)).not.toBe("0s");
    expect(formatToolDuration(1_500)).toBe("1.5s");
    expect(formatToolDuration(12_400)).toBe("12s");
    expect(formatToolDuration(65_000)).toBe("1m 5s");
    expect(formatToolDuration(120_000)).toBe("2m");
  });
});

describe("createEventPrinter", () => {
  it("prints a recorded duration on that call and skips a missing one", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      lines.push(String(line));
    });
    try {
      const printer = createEventPrinter();
      printer.onEvent({
        type: "tool_result",
        toolCallId: "a",
        content: "ok",
        isError: false,
        durationMs: 12,
      });
      printer.onEvent({
        type: "tool_result",
        toolCallId: "b",
        content: "old",
        isError: true,
      });
      expect(lines[0]).toBe("← 12ms  ok");
      expect(lines[1]).toBe("← ERR old");
      expect(lines[1]).not.toMatch(/\d+ms|<1ms/);
    } finally {
      spy.mockRestore();
    }
  });
});
