import { describe, expect, it } from "vitest";
import type { InputKey } from "./editor.js";
import {
  chordFromKey,
  DEFAULT_KEYBINDINGS,
  lookupKeybinding,
  normalizeChord,
  resolveKeybindings,
} from "./keybindings.js";

function key(partial: Partial<InputKey> = {}): InputKey {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...partial,
  };
}

describe("keybindings", () => {
  it("defaults Enter to submit and Shift+Enter to newline", () => {
    expect(lookupKeybinding("", key({ return: true }))).toEqual({ type: "submit" });
    expect(lookupKeybinding("", key({ return: true, shift: true }))).toEqual({
      type: "edit",
      op: { op: "newline" },
    });
    expect(DEFAULT_KEYBINDINGS.enter).toBe("submit");
    expect(DEFAULT_KEYBINDINGS["shift+enter"]).toBe("newline");
  });

  it("merges sparse overrides onto defaults", () => {
    const swapped = resolveKeybindings({
      Enter: "newline",
      "Shift+Enter": "submit",
    });
    expect(swapped.enter).toBe("newline");
    expect(swapped["shift+enter"]).toBe("submit");
    expect(swapped["ctrl+j"]).toBe("newline");
    expect(lookupKeybinding("", key({ return: true }), swapped)).toEqual({
      type: "edit",
      op: { op: "newline" },
    });
  });

  it("normalizes chord aliases", () => {
    expect(normalizeChord("Shift+Return")).toBe("shift+enter");
    expect(normalizeChord("ctrl + J")).toBe("ctrl+j");
    expect(normalizeChord("opt+enter")).toBe("alt+enter");
    expect(normalizeChord("PgUp")).toBe("pageup");
  });

  it("does not treat shifted letters as binding chords", () => {
    expect(chordFromKey("A", key({ shift: true }))).toBeNull();
    expect(lookupKeybinding("A", key({ shift: true }))).toBeNull();
  });
});
