import { describe, expect, it } from "vitest";
import { SIDE_BLOCK_GAP } from "../paint.js";
import {
  activitySpinnerRows,
  shineFrame,
  SHINE_MS,
  SPINNER_PAD_Y,
} from "./ActivitySpinner.js";

describe("ActivitySpinner", () => {
  it("steps the highlight slowly and keeps 1X padding above only", () => {
    expect(SHINE_MS).toBe(160);
    expect(SPINNER_PAD_Y).toBe(SIDE_BLOCK_GAP);
    expect(activitySpinnerRows(false)).toBe(0);
    expect(activitySpinnerRows(true)).toBe(SIDE_BLOCK_GAP + 1);
  });

  it("keeps the shine on a clock, not on token count", () => {
    expect(shineFrame(0)).toBe(0);
    expect(shineFrame(SHINE_MS - 1)).toBe(0);
    expect(shineFrame(SHINE_MS)).toBe(1);
    expect(shineFrame(SHINE_MS * 4)).toBe(4);
    expect(shineFrame(SHINE_MS * 4 + 80)).toBe(4);
  });
});
