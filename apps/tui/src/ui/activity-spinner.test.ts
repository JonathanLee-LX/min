import { describe, expect, it } from "vitest";
import { SHINE_MS } from "./ActivitySpinner.js";

describe("ActivitySpinner", () => {
  it("moves the highlight slower than a typical spinner tick", () => {
    expect(SHINE_MS).toBe(160);
  });
});
