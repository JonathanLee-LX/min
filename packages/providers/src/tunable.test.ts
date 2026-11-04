import { describe, expect, it, vi } from "vitest";
import { deepseekProvider } from "./deepseek.js";
import { modelControls, tunableProvider } from "./tunable.js";

describe("tunableProvider", () => {
  it("switches model and provider without replacing the outer object", () => {
    const provider = tunableProvider({ kind: "openai", model: "gpt-4.1", apiKey: "test" });
    const controls = modelControls(provider);
    expect(controls).toBe(provider.controls);
    expect(provider.id).toBe("openai:gpt-4.1");
    expect(controls?.models()).toContain("o3");

    controls?.setModel("o3");
    expect(provider.id).toBe("openai:o3");
    expect(controls?.selection()).toMatchObject({ kind: "openai", model: "o3" });

    controls?.setEffort("high");
    expect(controls?.selection().effort).toBe("high");
    controls?.setEffort(undefined);
    expect(controls?.selection().effort).toBeUndefined();

    controls?.setProvider({
      kind: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "test",
    });
    expect(provider.id).toBe("anthropic:claude-sonnet-4-5");
    expect(() => controls?.setModel("  ")).toThrow(/empty/);
    expect(() => controls?.setProvider({ kind: "missing" })).toThrow(/Unknown provider/);
  });

  it("accepts a stream replacement and keeps it across a model switch", async () => {
    const provider = tunableProvider({ kind: "mock" });
    const seen: string[] = [];
    const original = provider.stream!.bind(provider);
    provider.stream = async function* (req) {
      seen.push(req.messages[0]?.content[0]?.type === "text" ? req.messages[0].content[0].text : "");
      yield* original(req);
    };
    const chunks = [];
    for await (const chunk of provider.stream({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })) {
      chunks.push(chunk.type);
    }
    expect(seen).toEqual(["hi"]);
    expect(chunks).toContain("done");
    provider.controls.setModel("other");
    expect(provider.id).toBe("mock");
    expect(provider.stream).toBeTypeOf("function");
  });

  it("adopts the factory default model when none was requested", () => {
    const provider = tunableProvider({ kind: "deepseek", apiKey: "test" });
    expect(provider.id).toBe("deepseek:deepseek-flash");
    expect(provider.controls.selection().model).toBe("deepseek-flash");
  });
});

describe("deepseekProvider effort", () => {
  it("defaults responses thinking to high and honors an explicit none", async () => {
    const create = vi.fn().mockResolvedValue({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
    });
    const client = { responses: { create } } as never;
    await deepseekProvider({ client, model: "deepseek-flash" }).complete({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    expect(create.mock.calls[0]![0].reasoning).toEqual({ effort: "high" });

    await deepseekProvider({
      client,
      model: "deepseek-flash",
      reasoningEffort: "none",
    }).complete({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    expect(create.mock.calls[1]![0].reasoning).toEqual({ effort: "none" });
  });
});
