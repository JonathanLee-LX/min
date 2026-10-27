import { describe, expect, it, vi } from "vitest";
import { modelLikelyReasons, openaiProvider } from "./openai.js";

describe("openaiProvider", () => {
  it("streams reasoning summary deltas as thinking_delta", async () => {
    async function* events() {
      yield {
        type: "response.reasoning_summary_text.delta",
        delta: "consider options",
      };
      yield {
        type: "response.output_text.delta",
        delta: "answer",
      };
      yield {
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "answer" }],
            },
          ],
          usage: { input_tokens: 3, output_tokens: 2 },
        },
      };
    }

    const create = vi.fn().mockResolvedValue(events());
    const provider = openaiProvider({
      model: "o3-mini",
      client: { responses: { create } } as never,
    });

    const chunks = [];
    for await (const chunk of provider.stream!({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.map((c) => c.type)).toEqual([
      "thinking_delta",
      "text_delta",
      "done",
    ]);
    expect(chunks[0]).toEqual({ type: "thinking_delta", text: "consider options" });
    expect(create.mock.calls[0]![0].reasoning).toEqual({ summary: "auto" });
  });

  it("detects models that usually expose reasoning", () => {
    expect(modelLikelyReasons("o3-mini")).toBe(true);
    expect(modelLikelyReasons("deepseek-flash")).toBe(true);
    expect(modelLikelyReasons("gpt-4.1")).toBe(false);
  });

  it("yields done on response.incomplete (DeepSeek / truncated streams)", async () => {
    async function* events() {
      yield {
        type: "response.output_text.delta",
        delta: "partial",
      };
      yield {
        type: "response.incomplete",
        response: {
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "partial" }],
            },
          ],
          usage: { input_tokens: 3, output_tokens: 1 },
        },
      };
    }

    const create = vi.fn().mockResolvedValue(events());
    const provider = openaiProvider({
      model: "gpt-test",
      client: { responses: { create } } as never,
    });

    const chunks = [];
    for await (const chunk of provider.stream!({
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.map((c) => c.type)).toEqual(["text_delta", "done"]);
    expect(chunks[1]?.result?.stopReason).toBe("length");
    expect(chunks[1]?.result?.message.content).toEqual([
      { type: "text", text: "partial" },
    ]);
  });

  it("throws a descriptive error when the stream has no terminal event", async () => {
    async function* events() {
      yield { type: "response.created", response: { status: "in_progress" } };
      yield { type: "response.in_progress", response: { status: "in_progress" } };
    }
    const create = vi.fn().mockResolvedValue(events());
    const provider = openaiProvider({
      model: "gpt-test",
      client: { responses: { create } } as never,
    });

    await expect(async () => {
      for await (const _ of provider.stream!({
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      })) {
        /* drain */
      }
    }).rejects.toThrow(/without a terminal event/);
  });

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
