import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgent, snapshotAgentInFlight } from "./agent.js";
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

  it("exposes in-flight messages (including finished tools) before abort clears them", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [{ id: "c1", name: "slow", arguments: {} }],
        },
        { text: "done" },
      ]),
      tools: [
        defineTool({
          name: "slow",
          description: "slow",
          inputSchema: z.object({}),
          async execute() {
            await gate;
            return { content: "tool-ok" };
          },
        }),
      ],
    });

    const running = agent.run("go");
    await new Promise((r) => setTimeout(r, 30));
    const snap = snapshotAgentInFlight(agent);
    expect(snap?.some((m) => m.role === "user")).toBe(true);
    expect(snap?.some((m) => m.role === "assistant")).toBe(true);
    release();
    await running;
    expect(snapshotAgentInFlight(agent)).toBeUndefined();
    await agent.dispose();
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
