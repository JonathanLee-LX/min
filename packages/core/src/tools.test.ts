import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, ToolRegistry, toolToDefinition } from "./tools.js";

describe("ToolRegistry", () => {
  it("registers, lists, and executes tools", async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        name: "add",
        description: "Add two numbers",
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        async execute({ a, b }) {
          return { content: String(a + b) };
        },
      }),
    );

    expect(registry.list()).toHaveLength(1);
    expect(registry.has("add")).toBe(true);

    const ok = await registry.execute("add", { a: 2, b: 3 });
    expect(ok.content).toBe("5");
    expect(ok.durationMs).toEqual(expect.any(Number));
    expect(ok.durationMs).toBeGreaterThan(0);
  });

  it("rejects duplicate names and invalid args", async () => {
    const registry = new ToolRegistry();
    const tool = defineTool({
      name: "ping",
      description: "ping",
      inputSchema: z.object({ n: z.number() }),
      async execute() {
        return { content: "pong" };
      },
    });
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow(/already registered/);

    const bad = await registry.execute("ping", { n: "x" });
    expect(bad.isError).toBe(true);
    expect(bad.durationMs).toBeUndefined();

    const missing = await registry.execute("nope", {});
    expect(missing.isError).toBe(true);
    expect(missing.durationMs).toBeUndefined();
  });

  it("keeps a body duration and times overlapping calls apart", async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        name: "kept",
        description: "already timed",
        inputSchema: z.object({}),
        async execute() {
          return { content: "ok", durationMs: 5 };
        },
      }),
    );
    registry.register(
      defineTool({
        name: "fast",
        description: "fast",
        inputSchema: z.object({}),
        async execute() {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { content: "fast" };
        },
      }),
    );
    registry.register(
      defineTool({
        name: "slow",
        description: "slow",
        inputSchema: z.object({}),
        async execute() {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return { content: "slow" };
        },
      }),
    );

    const kept = await registry.execute("kept", {});
    expect(kept.durationMs).toBe(5);

    const [fast, slow] = await Promise.all([
      registry.execute("fast", {}),
      registry.execute("slow", {}),
    ]);
    expect(fast.durationMs).toBeGreaterThan(0);
    expect(slow.durationMs).toBeGreaterThan(fast.durationMs!);
    expect(fast.content).toBe("fast");
    expect(slow.content).toBe("slow");
  });

  it("converts zod schemas to JSON Schema definitions", () => {
    const tool = defineTool({
      name: "greet",
      description: "Greet",
      inputSchema: z.object({ name: z.string() }),
      async execute() {
        return { content: "hi" };
      },
    });
    const def = toolToDefinition(tool);
    expect(def.name).toBe("greet");
    expect(def.inputSchema).toMatchObject({
      type: "object",
      properties: { name: { type: "string" } },
    });
  });
});
