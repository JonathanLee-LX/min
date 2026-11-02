import { describe, expect, it, vi } from "vitest";
import {
  createKeyBuffer,
  isIncompleteKeySequence,
  takeCompleteSequence,
} from "./key-buffer.js";
import { createEditor, inputAction, reduceEditor } from "./editor.js";
import { decodeInput } from "./keys.js";

describe("key-buffer", () => {
  it("detects incomplete ESC / CSI prefixes", () => {
    expect(isIncompleteKeySequence("\x1b")).toBe(true);
    expect(isIncompleteKeySequence("\x1b[")).toBe(true);
    expect(isIncompleteKeySequence("\x1b[27;2;13")).toBe(true);
    expect(isIncompleteKeySequence("\x1b[<64;12;8")).toBe(true);
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
    expect(takeCompleteSequence("\x1b[<64;12;8Mtail")).toEqual({
      sequence: "\x1b[<64;12;8M",
      rest: "tail",
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

  it("simulates full typing, arrow movement, and Home key sequence", () => {
    const sequences: string[] = [];
    const buffer = createKeyBuffer((sequence) => sequences.push(sequence), 35);
    buffer.push("abcde");
    buffer.push("\x1b[D");
    buffer.push("\x1b[D");
    buffer.push("X");
    buffer.push("\x01");
    buffer.push("0");
    let state = createEditor();
    for (const seq of sequences) {
      const { input, key } = decodeInput(seq);
      const action = inputAction(input, key);
      if (action.type === "edit") {
        state = reduceEditor(state, action.op);
      }
    }
    expect(state.text).toBe("0abcXde");
    expect(state.cursor).toBe(1);
  });
});
