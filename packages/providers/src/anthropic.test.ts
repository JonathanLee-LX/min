import { describe, expect, it, vi } from "vitest";
import { anthropicProvider } from "./anthropic.js";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const PDF = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");

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
    expect(params.thinking).toBeUndefined();
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

  it("maps thinking effort onto an extended-thinking budget", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const provider = anthropicProvider({
      model: "claude-test",
      maxTokens: 4096,
      reasoningEffort: "high",
      client: { messages: { create } } as never,
    });
    await provider.complete({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    const [params] = create.mock.calls[0]!;
    expect(params.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    expect(params.max_tokens).toBe(9216);
  });

  it("maps hydrated image and pdf onto Anthropic user blocks", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const provider = anthropicProvider({
      model: "claude-test",
      client: { messages: { create } } as never,
    });
    const result = await provider.complete({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            {
              type: "image",
              mediaType: "image/png",
              blobId: "a".repeat(64),
              filename: "shot.png",
              data: PNG,
            },
            {
              type: "document",
              mediaType: "application/pdf",
              blobId: "b".repeat(64),
              filename: "spec.pdf",
              data: PDF,
            },
          ],
        },
      ],
    });
    const content = create.mock.calls[0]![0].messages[0].content as Array<{
      type: string;
      source?: { type: string; media_type: string; data: string };
      text?: string;
    }>;
    expect(content[0]).toEqual({ type: "text", text: "look" });
    expect(content[1]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/png" },
    });
    expect(content[2]).toMatchObject({
      type: "document",
      source: { type: "base64", media_type: "application/pdf" },
    });
    expect(result.message.content.map((part) => part.type)).toEqual(["text"]);
  });

  it("throws on unhydrated image parts", async () => {
    const create = vi.fn();
    const provider = anthropicProvider({
      model: "claude-test",
      client: { messages: { create } } as never,
    });
    await expect(
      provider.complete({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                mediaType: "image/png",
                blobId: "a".repeat(64),
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/unhydrated/);
    expect(create).not.toHaveBeenCalled();
  });
});
