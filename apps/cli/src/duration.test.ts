import { describe, expect, it, vi } from "vitest";
import { formatToolDuration, toolDurationLabel } from "./duration.js";
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

describe("toolDurationLabel", () => {
  it("ticks a live call, keeps a stored final value, and invents nothing", () => {
    expect(toolDurationLabel({ stored: undefined, now: 1_000 })).toBeUndefined();
    expect(toolDurationLabel({ stored: undefined, startedAt: 1_000, now: 1_000 })).toBe("<1ms");
    expect(toolDurationLabel({ stored: undefined, startedAt: 1_000, now: 1_400 })).toBe("400ms");
    expect(toolDurationLabel({ stored: 0, startedAt: 1_000, now: 1_400 })).toBe("0ms");
    expect(toolDurationLabel({ stored: 1_500, startedAt: 1_000, now: 9_000 })).toBe("1.5s");
    expect(toolDurationLabel({ stored: 400, now: 0 })).toBe("400ms");
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

  it("does not print ticks when stdout cannot refresh", () => {
    const lines: string[] = [];
    const writes: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      lines.push(String(line));
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const tty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
    try {
      const printer = createEventPrinter();
      printer.onEvent({
        type: "tool_call",
        phase: "running",
        toolCall: { type: "tool_call", id: "a", name: "bash", arguments: {} },
      });
      printer.onEvent({
        type: "tool_result",
        toolCallId: "a",
        content: "ok",
        isError: false,
        durationMs: 12,
      });
      expect(writes.join("")).not.toMatch(/<1ms|\d+ms/);
      expect(lines.at(-1)).toBe("← 12ms  ok");
    } finally {
      log.mockRestore();
      write.mockRestore();
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: tty });
    }
  });

  it("refreshes each running call on a TTY, then prints the stored duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T00:00:00.000Z"));
    const writes: string[] = [];
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      lines.push(String(line));
    });
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const tty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
    try {
      const printer = createEventPrinter();
      const call = (id: string, name: string) =>
        printer.onEvent({
          type: "tool_call",
          phase: "running",
          toolCall: { type: "tool_call", id, name, arguments: {} },
        });
      call("slow", "bash");
      expect(writes.at(-1)).toContain("bash");
      expect(writes.at(-1)).toContain("<1ms");
      vi.advanceTimersByTime(500);
      expect(writes.at(-1)).toContain("bash");
      expect(writes.at(-1)).toContain("500ms");
      call("fast", "glob");
      vi.advanceTimersByTime(200);
      expect(writes.at(-1)).toContain("glob");
      expect(writes.at(-1)).toContain("200ms");
      expect(writes.at(-1)).not.toContain("bash");
      printer.onEvent({
        type: "tool_result",
        toolCallId: "slow",
        content: "ok",
        isError: false,
        durationMs: 5_000,
      });
      printer.onEvent({
        type: "tool_result",
        toolCallId: "fast",
        content: "ok",
        isError: false,
        durationMs: 12,
      });
      expect(lines).toEqual(["← 5.0s  ok", "← 12ms  ok"]);
    } finally {
      log.mockRestore();
      write.mockRestore();
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: tty });
      vi.useRealTimers();
    }
  });
});
