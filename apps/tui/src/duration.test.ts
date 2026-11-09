import { describe, expect, it } from "vitest";
import { formatRunDuration } from "./duration.js";

describe("formatRunDuration", () => {
  it("formats seconds and minutes", () => {
    expect(formatRunDuration(0)).toBe("0s");
    expect(formatRunDuration(3400)).toBe("3s");
    expect(formatRunDuration(65_000)).toBe("1m 5s");
    expect(formatRunDuration(120_000)).toBe("2m");
  });
});
