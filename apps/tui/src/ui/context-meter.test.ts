import { describe, expect, it } from "vitest";
import type { ContextUsage } from "@min-agent/client";
import { contextMeterRows } from "./ContextMeter.js";

describe("contextMeterRows", () => {
  it("counts head and progress rows", () => {
    expect(contextMeterRows("", undefined)).toBe(0);
    expect(contextMeterRows("mock", undefined)).toBe(1);
    const usage = { ratio: 0.2 } as ContextUsage;
    expect(contextMeterRows("mock", usage)).toBe(2);
  });
});
