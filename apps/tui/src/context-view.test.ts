import { describe, expect, it } from "vitest";
import {
  formatContextUsageBreakdown,
  formatContextUsageShort,
  type ContextUsage,
} from "@min-agent/client";
import {
  bottomStatusLines,
  contextBreakdownLine,
  contextStatusLine,
} from "./context-view.js";

function sampleUsage(): ContextUsage {
  return {
    used: 4_200,
    limit: 32_000,
    ratio: 4_200 / 32_000,
    reservedOutput: 1024,
    estimated: true,
    strategy: "hybrid",
    parts: [
      { id: "system", label: "system", tokens: 400, share: 400 / 4200 },
      { id: "tools", label: "tools", tokens: 800, share: 800 / 4200 },
      { id: "conversation", label: "conversation", tokens: 3000, share: 3000 / 4200 },
      { id: "reserved", label: "reserved", tokens: 1024, share: 1024 / 32_000 },
    ],
  };
}

describe("context-view", () => {
  it("formats status and breakdown lines", () => {
    const usage = sampleUsage();
    expect(contextStatusLine(usage)).toBe(formatContextUsageShort(usage));
    expect(contextBreakdownLine(usage)).toBe(formatContextUsageBreakdown(usage));
    expect(contextStatusLine(usage)).toMatch(/^ctx /);
    expect(contextBreakdownLine(usage)).toMatch(/sys /);
    expect(contextBreakdownLine(undefined)).toBe("");
    expect(contextStatusLine(undefined)).toBe("");
  });

  it("builds bottom model + total context chrome without breakdown", () => {
    const usage = sampleUsage();
    expect(bottomStatusLines("deepseek:deepseek-flash", usage)).toEqual([
      `deepseek:deepseek-flash · ${formatContextUsageShort(usage)}`,
    ]);
    expect(bottomStatusLines("mock", undefined)).toEqual(["mock"]);
    expect(bottomStatusLines("", undefined)).toEqual([]);
  });
});
