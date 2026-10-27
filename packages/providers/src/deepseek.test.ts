import { describe, expect, it, vi } from "vitest";
import { deepseekProvider } from "./deepseek.js";

describe("deepseekProvider", () => {
  it("defaults to Responses API with deepseek-flash", async () => {
    const create = vi.fn().mockResolvedValue({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "ok" }],
        },
      ],
      status: "completed",
      usage: { input_tokens: 1, output_tokens: 1 },
      output_text: "ok",
    });

    const provider = deepseekProvider({
      apiKey: "test",
      client: { responses: { create } } as never,
    });

    expect(provider.id).toBe("deepseek:deepseek-flash");
    const result = await provider.complete({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![0].reasoning).toEqual({ effort: "high" });
    expect(result.message.content).toEqual([{ type: "text", text: "ok" }]);
  });

  it("chat mode uses Chat Completions with deepseek-chat", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "hi from chat" },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const provider = deepseekProvider({
      api: "chat",
      apiKey: "test",
      client: { chat: { completions: { create } } } as never,
    });

    expect(provider.id).toBe("deepseek:deepseek-chat");
    const result = await provider.complete({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    expect(create).toHaveBeenCalledOnce();
    expect(result.message.content).toEqual([
      { type: "text", text: "hi from chat" },
    ]);
  });
});
