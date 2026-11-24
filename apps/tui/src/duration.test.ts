import { describe, expect, it } from "vitest";
import { formatRunDuration, formatToolDuration } from "./duration.js";

describe("formatRunDuration", () => {
  it("formats seconds and minutes", () => {
    expect(formatRunDuration(0)).toBe("0s");
    expect(formatRunDuration(3400)).toBe("3s");
    expect(formatRunDuration(65_000)).toBe("1m 5s");
    expect(formatRunDuration(120_000)).toBe("2m");
  });
});

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
