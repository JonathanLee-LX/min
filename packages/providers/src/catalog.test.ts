import { describe, expect, it } from "vitest";
import { modelLikelyReasons, modelSupportsEffort, modelsFor } from "./catalog.js";

describe("catalog", () => {
  it("puts the current model first when it is not already suggested", () => {
    expect(modelsFor("deepseek")).toEqual([
      "deepseek-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
    ]);
    expect(modelsFor("deepseek", "deepseek-flash")[0]).toBe("deepseek-flash");
    expect(modelsFor("deepseek", "custom-flash")[0]).toBe("custom-flash");
    expect(modelsFor("mock", "mock-1")).toEqual(["mock-1"]);
  });

  it("offers a thinking submenu for providers and models that accept effort", () => {
    expect(modelSupportsEffort("deepseek", "deepseek-flash")).toBe(true);
    expect(modelSupportsEffort("anthropic", "claude-sonnet-4-5")).toBe(true);
    expect(modelSupportsEffort("openai", "o3")).toBe(true);
    expect(modelSupportsEffort("openai", "gpt-4.1")).toBe(false);
    expect(modelSupportsEffort("openai-chat", "o4-mini")).toBe(true);
    expect(modelSupportsEffort("openai-chat", "gpt-4.1-mini")).toBe(false);
    expect(modelSupportsEffort("mock", "mock")).toBe(false);
    expect(modelLikelyReasons("gpt-5")).toBe(true);
  });
});
