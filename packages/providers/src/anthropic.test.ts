import { describe, expect, it, vi } from "vitest";
import { anthropicProvider } from "./anthropic.js";

describe("anthropicProvider", () => {
  it("maps internal messages to Anthropic Messages and back", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [
        { type: "text", text: "Calling tool" },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "echo",
          input: { message: "hi" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const provider = anthropicProvider({
      model: "claude-test",
      client: { messages: { create } } as never,
    });

    const result = await provider.complete({
      system: "Be helpful",
      messages: [
        { role: "user", content: [{ type: "text", text: "hello" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              id: "toolu_0",
              name: "echo",
              arguments: { message: "prev" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "toolu_0",
              content: "prev",
            },
          ],
        },
        { role: "user", content: [{ type: "text", text: "again" }] },
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
    expect(params.model).toBe("claude-test");
    expect(params.system).toBe("Be helpful");
    expect(params.tools[0].name).toBe("echo");
    expect(params.messages.some((m: { role: string }) => m.role === "user")).toBe(
      true,
    );

    expect(result.stopReason).toBe("tool_use");
    expect(result.message.content).toEqual([
      { type: "text", text: "Calling tool" },
      {
        type: "tool_call",
        id: "toolu_1",
        name: "echo",
        arguments: { message: "hi" },
      },
    ]);
  });
});
