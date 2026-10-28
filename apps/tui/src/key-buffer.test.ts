import { describe, expect, it, vi } from "vitest";
import {
  createKeyBuffer,
  isIncompleteKeySequence,
  takeCompleteSequence,
} from "./key-buffer.js";

describe("key-buffer", () => {
  it("detects incomplete ESC / CSI prefixes", () => {
    expect(isIncompleteKeySequence("\x1b")).toBe(true);
    expect(isIncompleteKeySequence("\x1b[")).toBe(true);
    expect(isIncompleteKeySequence("\x1b[27;2;13")).toBe(true);
    expect(isIncompleteKeySequence("\x1b[27;2;13~")).toBe(false);
    expect(isIncompleteKeySequence("a")).toBe(false);
  });

  it("takes a complete Shift+Enter sequence", () => {
    expect(takeCompleteSequence("\x1b[27;2;13~abc")).toEqual({
      sequence: "\x1b[27;2;13~",
      rest: "abc",
    });
    expect(takeCompleteSequence("\x1b[13;2u")).toEqual({
      sequence: "\x1b[13;2u",
      rest: "",
    });
  });

  it("reassembles Shift+Enter delivered across chunks", () => {
    vi.useFakeTimers();
    const sequences: string[] = [];
    const buffer = createKeyBuffer((sequence) => sequences.push(sequence), 35);
    buffer.push("\x1b");
    expect(sequences).toEqual([]);
    buffer.push("[27;2;13~");
    expect(sequences).toEqual(["\x1b[27;2;13~"]);
    vi.useRealTimers();
  });

  it("flushes a bare Escape after the timeout", () => {
    vi.useFakeTimers();
    const sequences: string[] = [];
    const buffer = createKeyBuffer((sequence) => sequences.push(sequence), 35);
    buffer.push("\x1b");
    expect(sequences).toEqual([]);
    vi.advanceTimersByTime(35);
    expect(sequences).toEqual(["\x1b"]);
    vi.useRealTimers();
  });
});
