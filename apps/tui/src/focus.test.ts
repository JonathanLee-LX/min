import { describe, expect, it } from "vitest";
import { FOCUS_IN, FOCUS_OUT, focusStateFromChunk, isFocusChunk } from "./focus.js";

describe("focus reporting", () => {
  it("detects focus in/out chunks", () => {
    expect(isFocusChunk(FOCUS_IN)).toBe(true);
    expect(isFocusChunk(FOCUS_OUT)).toBe(true);
    expect(isFocusChunk(`${FOCUS_OUT}${FOCUS_IN}`)).toBe(true);
    expect(isFocusChunk("a")).toBe(false);
    expect(isFocusChunk(`${FOCUS_IN}x`)).toBe(false);
  });

  it("parses the last report in a batch", () => {
    expect(focusStateFromChunk(FOCUS_IN)).toBe(true);
    expect(focusStateFromChunk(FOCUS_OUT)).toBe(false);
    expect(focusStateFromChunk(`${FOCUS_IN}${FOCUS_OUT}`)).toBe(false);
    expect(focusStateFromChunk("hello")).toBeNull();
  });
});
