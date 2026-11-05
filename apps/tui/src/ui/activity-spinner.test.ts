import { describe, expect, it } from "vitest";
import { SHINE_MS } from "./ActivitySpinner.js";

describe("ActivitySpinner", () => {
  it("steps the highlight often enough for a soft slide", () => {
    expect(SHINE_MS).toBe(80);
  });
});
