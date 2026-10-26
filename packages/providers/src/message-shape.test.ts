import { describe, expect, it, vi } from "vitest";
import { openaiProvider } from "./openai.js";

const CORE_PART_TYPES = new Set(["text", "tool_call", "tool_result"]);

describe("provider message shape contract", () => {
  it("maps OpenAI Responses output into core ContentParts only", async () => {
    const create = vi.fn().mockResolvedValue({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Using a tool" }],
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "echo",
          arguments: JSON.stringify({ message: "hi" }),
        },
      ],
      status: "completed",
      usage: { input_tokens: 8, output_tokens: 4 },
      output_text: "Using a tool",
    });

    const provider = openaiProvider({
      model: "gpt-test",
      client: { responses: { create } } as never,
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      tools: [
        {
          name: "echo",
          description: "Echo",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
          },
        },
      ],
    });

    for (const part of result.message.content) {
      expect(CORE_PART_TYPES.has(part.type)).toBe(true);
      expect(part).not.toHaveProperty("output_text");
      expect(part).not.toHaveProperty("call_id");
    }
    expect(result.message.content).toEqual([
      { type: "text", text: "Using a tool" },
      {
        type: "tool_call",
        id: "call_1",
        name: "echo",
        arguments: { message: "hi" },
      },
    ]);
  });
});
