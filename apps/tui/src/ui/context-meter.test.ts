import { describe, expect, it } from "vitest";
import { contextMeterRows } from "./ContextMeter.js";

describe("contextMeterRows", () => {
  it("reserves two status rows when cwd or model is set", () => {
    expect(contextMeterRows("", "")).toBe(0);
    expect(contextMeterRows("/tmp", "mock")).toBe(2);
    expect(contextMeterRows("/tmp", "")).toBe(2);
  });
});
