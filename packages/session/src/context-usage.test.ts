import { describe, expect, it } from "vitest";
import {
  computeContextUsage,
  formatContextUsageBreakdown,
  formatContextUsageShort,
  formatTokenCount,
  withContextUsage,
} from "./context-usage.js";

describe("computeContextUsage", () => {
  it("reports used/limit and flat system+tools+conversation shares", () => {
    const usage = computeContextUsage({
      limit: 1000,
      reservedOutput: 100,
      system: "You are helpful.", // ~5 tokens text + 4 framing
      tools: [
        {
          name: "bash",
          description: "run",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      messages: [
        { role: "user", content: [{ type: "text", text: "hello world" }] },
        { role: "assistant", content: [{ type: "text", text: "hi there friend" }] },
      ],
      strategy: "hybrid",
    });

    expect(usage.limit).toBe(1000);
    expect(usage.reservedOutput).toBe(100);
    expect(usage.estimated).toBe(true);
    expect(usage.strategy).toBe("hybrid");
    expect(usage.used).toBeGreaterThan(0);
    expect(usage.ratio).toBeCloseTo(usage.used / 1000);

    const ids = usage.parts.map((part) => part.id);
    expect(ids).toContain("system");
    expect(ids).toContain("tools");
    expect(ids).toContain("conversation");
    expect(ids).toContain("reserved");

    const contentShare = usage.parts
      .filter((part) => part.id !== "reserved")
      .reduce((sum, part) => sum + part.share, 0);
    expect(contentShare).toBeCloseTo(1, 5);
  });

  it("splits labeled skills and mcp from system/tools", () => {
    const usage = computeContextUsage({
      limit: 8000,
      reservedOutput: 1024,
      parts: {
        systemParts: [
          { id: "system", text: "base agent instructions here" },
          { id: "skills", text: "Available skills:\n- demo: does demos" },
        ],
        toolGroups: [
          {
            id: "tools",
            tools: [
              {
                name: "bash",
                description: "shell",
                inputSchema: { type: "object" },
              },
            ],
          },
          {
            id: "skills",
            tools: [
              {
                name: "load_skill",
                description: "load",
                inputSchema: { type: "object" },
              },
            ],
          },
          {
            id: "mcp",
            tools: [
              {
                name: "mcp_search",
                description: "search",
                inputSchema: { type: "object" },
              },
            ],
          },
        ],
      },
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
    });

    const byId = Object.fromEntries(usage.parts.map((part) => [part.id, part.tokens]));
    expect(byId.skills).toBeGreaterThan(0);
    expect(byId.mcp).toBeGreaterThan(0);
    expect(byId.tools).toBeGreaterThan(0);
    expect(byId.system).toBeGreaterThan(0);
    expect(byId.conversation).toBeGreaterThan(0);
  });

  it("formats short and breakdown strings", () => {
    expect(formatTokenCount(420)).toBe("420");
    expect(formatTokenCount(12_400)).toBe("12k");
    const usage = computeContextUsage({
      limit: 32_000,
      system: "x".repeat(400),
      messages: [{ role: "user", content: [{ type: "text", text: "y".repeat(800) }] }],
    });
    expect(formatContextUsageShort(usage)).toMatch(/^ctx \d+(\.\d)?k?\/32k \d+%$/);
    expect(formatContextUsageBreakdown(usage)).toMatch(/sys \d+%/);
    expect(formatContextUsageBreakdown(usage)).toMatch(/conv \d+%/);
  });

  it("attaches usage onto an assemble-shaped result", () => {
    const result = withContextUsage(
      {
        view: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        estimatedTokens: 10,
        strategy: "trim",
      },
      { limit: 1000, system: "sys" },
    );
    expect(result.usage.strategy).toBe("trim");
    expect(result.usage.used).toBeGreaterThan(0);
  });
});
