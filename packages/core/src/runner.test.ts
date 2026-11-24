import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "./agent.js";
import { imagePart, userMessageWithParts } from "./messages.js";
import { mockProvider } from "./provider.js";
import { defineTool } from "./tools.js";

describe("Runner / createAgent", () => {
  it("runs a multi-turn tool loop with a mock provider", async () => {
    const events: string[] = [];
    const add = defineTool({
      name: "add",
      description: "Add",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      async execute({ a, b }) {
        return { content: String(a + b) };
      },
    });

    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [{ name: "add", arguments: { a: 1, b: 2 } }],
        },
        { text: "Sum is 3" },
      ]),
      tools: [add],
      system: "You are a calculator.",
    });

    const result = await agent.run({
      input: "1+2",
      onEvent(e) {
        events.push(e.type);
      },
    });

    expect(result.text).toBe("Sum is 3");
    expect(result.turns).toBe(2);
    expect(events).toContain("tool_call");
    expect(events).toContain("tool_result");
    expect(events).toContain("done");
    await agent.dispose();
  });

  it("re-reads a system getter before each completion", async () => {
    let note = "one";
    const provider = mockProvider([{ text: "a" }, { text: "b" }]);
    const agent = await createAgent({
      provider,
      system: () => note,
    });

    await agent.run("hi");
    note = "two";
    await agent.run("again");

    expect(provider.calls[0]?.system).toBe("one");
    expect(provider.calls[1]?.system).toBe("two");
    await agent.dispose();
  });

  it("stops at maxTurns", async () => {
    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [{ name: "noop", arguments: {} }],
        },
      ]),
      tools: [
        defineTool({
          name: "noop",
          description: "noop",
          inputSchema: z.object({}),
          async execute() {
            return { content: "ok" };
          },
        }),
      ],
      maxTurns: 2,
    });

    const result = await agent.run("loop");
    expect(result.turns).toBe(2);
    await agent.dispose();
  });

  it("streams text_delta chunks from provider.stream", async () => {
    const deltas: string[] = [];
    const agent = await createAgent({
      provider: mockProvider([{ text: "abcdef" }]),
    });

    const result = await agent.run({
      input: "hi",
      onEvent(e) {
        if (e.type === "text_delta") deltas.push(e.text);
      },
    });

    expect(result.text).toBe("abcdef");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe("abcdef");
    await agent.dispose();
  });

  it("forwards thinking_delta chunks from provider.stream", async () => {
    const thinking: string[] = [];
    const provider = {
      id: "think-mock",
      async complete() {
        return {
          message: { role: "assistant" as const, content: [{ type: "text" as const, text: "ok" }] },
          stopReason: "end" as const,
        };
      },
      async *stream() {
        yield { type: "thinking_delta" as const, text: "plan" };
        yield { type: "text_delta" as const, text: "ok" };
        yield {
          type: "done" as const,
          result: {
            message: { role: "assistant" as const, content: [{ type: "text" as const, text: "ok" }] },
            stopReason: "end" as const,
          },
        };
      },
    };
    const agent = await createAgent({ provider });
    await agent.run({
      input: "hi",
      onEvent(e) {
        if (e.type === "thinking_delta") thinking.push(e.text);
      },
    });
    expect(thinking).toEqual(["plan"]);
    await agent.dispose();
  });

  it("forwards hydrated image parts to the provider unchanged", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const blobId = "a".repeat(64);
    const provider = mockProvider([{ text: "ok" }]);
    const agent = await createAgent({ provider });
    const user = userMessageWithParts([
      imagePart({
        mediaType: "image/png",
        blobId,
        filename: "shot.png",
        data: png,
      }),
    ]);
    const events: string[] = [];
    await agent.run({
      input: [user],
      onEvent(event) {
        events.push(event.type);
      },
    });
    const seen = provider.calls[0]?.messages[0]?.content[0];
    expect(seen).toMatchObject({
      type: "image",
      blobId,
      filename: "shot.png",
    });
    expect(seen && "data" in seen ? seen.data : undefined).toEqual(png);
    expect(events).not.toContain("attachment");
    expect(new Set(events)).toEqual(new Set(["turn_start", "text_delta", "turn_end", "done"]));
    await agent.dispose();
  });

  it("records each tool body's duration on the result and the event", async () => {
    let now = 1_000;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const events: Array<{
        type: string;
        durationMs?: number;
        toolCallId?: string;
        phase?: string;
      }> = [];
      const agent = await createAgent({
        provider: mockProvider([
          {
            toolCalls: [
              { id: "a", name: "fast", arguments: {} },
              { id: "b", name: "slow", arguments: {} },
            ],
          },
          { text: "done" },
        ]),
        tools: [
          defineTool({
            name: "fast",
            description: "fast",
            inputSchema: z.object({}),
            async execute() {
              now += 10;
              return { content: "F" };
            },
          }),
          defineTool({
            name: "slow",
            description: "slow",
            inputSchema: z.object({}),
            async execute() {
              now += 30;
              return { content: "S" };
            },
          }),
        ],
      });
      const result = await agent.run({
        input: "go",
        onEvent(event) {
          if (event.type === "tool_call") {
            events.push({
              type: event.type,
              toolCallId: event.toolCall.id,
              ...(event.phase ? { phase: event.phase } : {}),
            });
            expect(event).not.toHaveProperty("durationMs");
          }
          if (event.type === "tool_result") {
            events.push({
              type: event.type,
              toolCallId: event.toolCallId,
              durationMs: event.durationMs,
            });
          }
        },
      });
      expect(events).toEqual([
        { type: "tool_call", toolCallId: "a" },
        { type: "tool_call", toolCallId: "a", phase: "running" },
        { type: "tool_result", toolCallId: "a", durationMs: 10 },
        { type: "tool_call", toolCallId: "b" },
        { type: "tool_call", toolCallId: "b", phase: "running" },
        { type: "tool_result", toolCallId: "b", durationMs: 30 },
      ]);
      const tool = result.messages.find((message) => message.role === "tool");
      expect(tool?.content).toMatchObject([
        { type: "tool_result", toolCallId: "a", durationMs: 10 },
        { type: "tool_result", toolCallId: "b", durationMs: 30 },
      ]);
      expect(JSON.stringify(result.messages)).not.toContain("running");
      expect(JSON.stringify(tool?.content).match(/"durationMs"/g)).toHaveLength(2);
      await agent.dispose();
    } finally {
      spy.mockRestore();
    }
  });

  it("emits the time already spent when a tool run is cancelled", async () => {
    let now = 500;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => now);
    const ac = new AbortController();
    try {
      const events: Array<{ type: string; durationMs?: number }> = [];
      const agent = await createAgent({
        provider: mockProvider([
          { toolCalls: [{ id: "c", name: "hang", arguments: {} }] },
          { text: "should not continue" },
        ]),
        tools: [
          defineTool({
            name: "hang",
            description: "hang",
            inputSchema: z.object({}),
            async execute() {
              now += 22;
              ac.abort();
              return { content: "late" };
            },
          }),
        ],
      });
      await expect(
        agent.run({
          input: "go",
          signal: ac.signal,
          onEvent(event) {
            if (event.type === "tool_result") {
              events.push({ type: event.type, durationMs: event.durationMs });
            }
          },
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(events).toEqual([{ type: "tool_result", durationMs: 22 }]);
      await agent.dispose();
    } finally {
      spy.mockRestore();
    }
  });

  it("aborts when signal is already aborted", async () => {
    const agent = await createAgent({
      provider: mockProvider([{ text: "nope" }]),
    });
    const ac = new AbortController();
    ac.abort();
    await expect(
      agent.run({ input: "hi", signal: ac.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await agent.dispose();
  });
});
