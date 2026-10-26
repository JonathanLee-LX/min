import { createAgent, type ModelProvider } from "@min-agent/core";
import { describe, expect, it } from "vitest";
import "./builtins.js";
import {
  createProvider,
  hasProvider,
  listProviders,
  registerProvider,
  unregisterProvider,
} from "./registry.js";

describe("provider registry", () => {
  it("ships common providers without going through @min-agent/core adapters", () => {
    for (const id of ["mock", "openai", "openai-chat", "anthropic", "deepseek"]) {
      expect(hasProvider(id)).toBe(true);
    }
    expect(createProvider("mock").id).toBe("mock");
  });

  it("accepts an external provider without changing core", async () => {
    const custom: ModelProvider = {
      id: "acme",
      async complete() {
        return {
          message: { role: "assistant", content: [{ type: "text", text: "acme" }] },
          stopReason: "end",
        };
      },
    };
    registerProvider("acme", () => custom);
    expect(listProviders()).toContain("acme");

    const agent = await createAgent({ provider: createProvider("acme") });
    const result = await agent.run("hi");
    expect(result.text).toBe("acme");
    await agent.dispose();

    unregisterProvider("acme");
    expect(hasProvider("acme")).toBe(false);
    expect(() => createProvider("acme")).toThrow(/Unknown provider: acme/);
  });
});
