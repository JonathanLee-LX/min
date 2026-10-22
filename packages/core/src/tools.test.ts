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
    expect(ok).toEqual({ content: "5" });
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

    const missing = await registry.execute("nope", {});
    expect(missing.isError).toBe(true);
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
