import { describe, expect, it, vi } from "vitest";
import { openaiChatProvider } from "./openai-chat.js";

describe("openaiChatProvider", () => {
  it("maps internal messages to Chat Completions and back", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: "Using echo",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "echo",
                  arguments: JSON.stringify({ message: "hi" }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    });

    const provider = openaiChatProvider({
      model: "deepseek-chat",
      id: "deepseek",
      client: { chat: { completions: { create } } } as never,
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

    expect(provider.id).toBe("deepseek:deepseek-chat");
    expect(create).toHaveBeenCalledOnce();
    const [params] = create.mock.calls[0]!;
    expect(params.model).toBe("deepseek-chat");
    expect(params.messages[0]).toEqual({ role: "system", content: "Be brief" });
    expect(params.tools[0].function.name).toBe("echo");

    expect(result.stopReason).toBe("tool_use");
    expect(result.message.content).toContainEqual({
      type: "tool_call",
      id: "call_1",
      name: "echo",
      arguments: { message: "hi" },
    });
  });
});
