import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "./agent.js";
import { defineExtension } from "./extension.js";
import { mockProvider } from "./provider.js";
import { defineTool } from "./tools.js";

describe("permission enforcement", () => {
  it("denies tool execution and continues the loop", async () => {
    const bash = defineTool({
      name: "bash",
      description: "run",
      inputSchema: z.object({ command: z.string() }),
      async execute() {
        return { content: "should not run" };
      },
    });

    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [{ name: "bash", arguments: { command: "rm -rf /" } }],
        },
        { text: "Understood, I will not run that." },
      ]),
      tools: [bash],
      permissionHandler: () => ({
        action: "deny",
        reason: "bash blocked",
      }),
    });

    const events: string[] = [];
    const result = await agent.run({
      input: "delete everything",
      onEvent(e) {
        events.push(e.type);
      },
    });

    expect(events).toContain("permission");
    expect(result.text).toContain("Understood");
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(JSON.stringify(toolMsg)).toContain("Permission denied");
    await agent.dispose();
  });

  it("asks and allows when onPermissionAsk returns allow", async () => {
    const write = defineTool({
      name: "write_file",
      description: "write",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      async execute({ path }) {
        return { content: `wrote ${path}` };
      },
    });

    const ask = vi.fn().mockResolvedValue("allow");

    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [
            {
              name: "write_file",
              arguments: { path: "a.txt", content: "x" },
            },
          ],
        },
        { text: "done" },
      ]),
      tools: [write],
      permissionHandler: () => ({
        action: "ask",
        reason: "confirm write",
      }),
    });

    const result = await agent.run({
      input: "write",
      onPermissionAsk: ask,
    });

    expect(ask).toHaveBeenCalledOnce();
    expect(result.text).toBe("done");
    expect(JSON.stringify(result.messages)).toContain("wrote a.txt");
    await agent.dispose();
  });

  it("applies grantRoot via onPermissionAsk before execute", async () => {
    const roots: string[] = [];
    const read = defineTool({
      name: "read_file",
      description: "read",
      inputSchema: z.object({ path: z.string() }),
      async execute({ path }) {
        return { content: `ok:${path}` };
      },
    });

    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [{ name: "read_file", arguments: { path: "../x" } }],
        },
        { text: "read done" },
      ]),
      tools: [read],
      permissionHandler: () => ({
        action: "ask",
        reason: "need root",
        grantRoot: "/tmp/granted-root",
      }),
    });

    const result = await agent.run({
      input: "read outside",
      onPermissionAsk: async (req) => {
        if (req.grantRoot) roots.push(req.grantRoot);
        return "allow";
      },
    });

    expect(roots).toEqual(["/tmp/granted-root"]);
    expect(JSON.stringify(result.messages)).toContain("ok:../x");
    await agent.dispose();
  });

  it("treats ask without approver as deny", async () => {
    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [{ name: "bash", arguments: { command: "id" } }],
        },
        { text: "ok" },
      ]),
      tools: [
        defineTool({
          name: "bash",
          description: "run",
          inputSchema: z.object({ command: z.string() }),
          async execute() {
            return { content: "ran" };
          },
        }),
      ],
      extensions: [
        defineExtension({
          name: "perm",
          setup(api) {
            api.setPermissionHandler(() => ({
              action: "ask",
              reason: "need approval",
            }));
          },
        }),
      ],
    });

    const result = await agent.run("go");
    expect(JSON.stringify(result.messages)).toContain("Permission denied");
    expect(JSON.stringify(result.messages)).not.toContain('"ran"');
    await agent.dispose();
  });
});
