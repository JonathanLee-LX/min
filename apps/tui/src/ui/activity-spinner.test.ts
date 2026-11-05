import { describe, expect, it } from "vitest";
import { SIDE_BLOCK_GAP } from "../paint.js";
import { activitySpinnerRows, SHINE_MS, SPINNER_PAD_Y } from "./ActivitySpinner.js";

describe("ActivitySpinner", () => {
  it("steps the highlight slowly and keeps 1X vertical padding", () => {
    expect(SHINE_MS).toBe(160);
    expect(SPINNER_PAD_Y).toBe(SIDE_BLOCK_GAP);
    expect(activitySpinnerRows(false)).toBe(0);
    expect(activitySpinnerRows(true)).toBe(SIDE_BLOCK_GAP * 2 + 1);
  });
});
