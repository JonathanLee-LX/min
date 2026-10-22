import { describe, expect, it, vi } from "vitest";
import { openaiProvider } from "./openai.js";

describe("openaiProvider", () => {
  it("maps internal messages to OpenAI Responses and back", async () => {
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
      system: "Be brief",
      messages: [
        { role: "user", content: [{ type: "text", text: "hello" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              id: "call_0",
              name: "echo",
              arguments: { message: "prev" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            { type: "tool_result", toolCallId: "call_0", content: "prev" },
          ],
        },
      ],
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

    expect(create).toHaveBeenCalledOnce();
    const [params] = create.mock.calls[0]!;
    expect(params.model).toBe("gpt-test");
    expect(params.instructions).toBe("Be brief");
    expect(params.store).toBe(false);
    expect(params.tools[0]).toMatchObject({ type: "function", name: "echo" });
    expect(params.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "hello" }),
        expect.objectContaining({
          type: "function_call",
          call_id: "call_0",
        }),
        expect.objectContaining({
          type: "function_call_output",
          call_id: "call_0",
        }),
      ]),
    );

    expect(result.stopReason).toBe("tool_use");
    expect(result.message.content).toContainEqual({
      type: "tool_call",
      id: "call_1",
      name: "echo",
      arguments: { message: "hi" },
    });
  });
});
