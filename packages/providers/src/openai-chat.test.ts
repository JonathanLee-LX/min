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

  it("forwards reasoning_effort on complete and stream, including none and max", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { content: "ok" } }],
      })
      .mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] };
        })(),
      );
    const provider = openaiChatProvider({
      model: "deepseek-chat",
      reasoningEffort: "none",
      client: { chat: { completions: { create } } } as never,
    });
    await provider.complete({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    expect(create.mock.calls[0]![0].reasoning_effort).toBe("none");
    expect(create.mock.calls[0]![0].stream).toBeUndefined();

    const streaming = openaiChatProvider({
      model: "deepseek-chat",
      reasoningEffort: "max",
      client: { chat: { completions: { create } } } as never,
    });
    const kinds = [];
    for await (const chunk of streaming.stream!({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })) {
      kinds.push(chunk.type);
    }
    expect(create.mock.calls[1]![0].reasoning_effort).toBe("max");
    expect(create.mock.calls[1]![0].stream).toBe(true);
    expect(kinds).toContain("done");
  });

  it("maps images to chat image_url content parts", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    const create = vi.fn().mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "ok" } }],
    });
    const provider = openaiChatProvider({
      model: "gpt-4.1",
      client: { chat: { completions: { create } } } as never,
    });
    await provider.complete({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            {
              type: "image",
              mediaType: "image/png",
              blobId: "a".repeat(64),
              data: png,
            },
          ],
        },
      ],
    });
    const content = create.mock.calls[0]![0].messages.find(
      (message: { role: string }) => message.role === "user",
    ).content;
    expect(content).toEqual(
      expect.arrayContaining([
        { type: "text", text: "look" },
        {
          type: "image_url",
          image_url: {
            url: expect.stringMatching(/^data:image\/png;base64,/),
          },
        },
      ]),
    );
  });

  it("rejects pdf parts on chat completions", async () => {
    const create = vi.fn();
    const provider = openaiChatProvider({
      model: "gpt-4.1",
      client: { chat: { completions: { create } } } as never,
    });
    await expect(
      provider.complete({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                mediaType: "application/pdf",
                blobId: "b".repeat(64),
                data: new TextEncoder().encode("%PDF-1.4\n"),
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/pdf|document/i);
    expect(create).not.toHaveBeenCalled();
  });
});
