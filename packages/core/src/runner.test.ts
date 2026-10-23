import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "./agent.js";
import { defineExtension } from "./extension.js";
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

  it("fires extension hooks and registers extension tools", async () => {
    const before = vi.fn();
    const afterTool = vi.fn();

    const ext = defineExtension({
      name: "test-ext",
      setup(api) {
        api.registerTool(
          defineTool({
            name: "ext_tool",
            description: "from extension",
            inputSchema: z.object({ x: z.string() }),
            async execute({ x }) {
              return { content: `ext:${x}` };
            },
          }),
        );
        api.addHook({
          onBeforeTurn: before,
          onAfterTool: afterTool,
        });
        api.appendSystem("Extension note.");
      },
    });

    const provider = mockProvider([
      {
        toolCalls: [{ name: "ext_tool", arguments: { x: "ok" } }],
      },
      { text: "done" },
    ]);

    const agent = await createAgent({
      provider,
      extensions: [ext],
    });

    const result = await agent.run("go");
    expect(result.text).toBe("done");
    expect(before).toHaveBeenCalled();
    expect(afterTool).toHaveBeenCalled();
    expect(provider.calls[0]?.system).toContain("Extension note.");
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
