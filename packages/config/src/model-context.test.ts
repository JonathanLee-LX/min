import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_CONTEXT_TOKENS, effectiveMaxContextTokens, modelIdFromProviderId } from "./model-context.js";

describe("model context", () => {
  it("strips the provider prefix from provider ids", () => {
    expect(modelIdFromProviderId("openai:gpt-4.1")).toBe("gpt-4.1");
    expect(modelIdFromProviderId("mock")).toBe("mock");
  });

  it("resolves context size by precedence", () => {
    expect(
      effectiveMaxContextTokens({
        model: "o3",
        modelContextTokens: { o3: 200_000, "gpt-4.1": 128_000 },
        global: 64_000,
        flag: 8000,
      }),
    ).toBe(8000);
    expect(
      effectiveMaxContextTokens({
        model: "o3",
        modelContextTokens: { o3: 200_000 },
        global: 64_000,
      }),
    ).toBe(200_000);
    expect(
      effectiveMaxContextTokens({
        model: "custom",
        providerSpec: { kind: "openai", maxContextTokens: 32_000 },
        global: 64_000,
      }),
    ).toBe(32_000);
    expect(
      effectiveMaxContextTokens({
        model: "gpt-4.1",
        global: 64_000,
      }),
    ).toBe(64_000);
    expect(effectiveMaxContextTokens({ model: "x" })).toBe(DEFAULT_MODEL_CONTEXT_TOKENS);
  });
});
