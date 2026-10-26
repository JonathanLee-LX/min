import { createAgent, defineTool, mockProvider } from "@min/core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createPermissionGate } from "./permission-protocol.js";

describe("permission gate", () => {
  it("denies tool execution and continues the loop", async () => {
    const bash = defineTool({
      name: "bash",
      description: "run",
      inputSchema: z.object({ command: z.string() }),
      async execute() {
        return { content: "should not run" };
      },
    });
    const gate = createPermissionGate(() => ({
      action: "deny",
      reason: "bash blocked",
    }));

    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [{ name: "bash", arguments: { command: "rm -rf /" } }],
        },
        { text: "Understood, I will not run that." },
      ]),
      tools: gate.wrap([bash]),
    });

    const result = await agent.run("delete everything");
    expect(result.text).toContain("Understood");
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(JSON.stringify(toolMsg)).toContain("Permission denied");
    expect(JSON.stringify(toolMsg)).not.toContain("should not run");
  });

  it("asks and allows when the approver returns allow", async () => {
    const write = defineTool({
      name: "write_file",
      description: "write",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      async execute({ path }) {
        return { content: `wrote ${path}` };
      },
    });
    const gate = createPermissionGate(() => ({
      action: "ask",
      reason: "confirm write",
    }));
    const ask = vi.fn().mockResolvedValue("allow");
    gate.setAsk(ask);

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
      tools: gate.wrap([write]),
    });

    const result = await agent.run("write");
    expect(ask).toHaveBeenCalledOnce();
    expect(result.text).toBe("done");
    expect(JSON.stringify(result.messages)).toContain("wrote a.txt");
  });

  it("passes grantRoot to the approver before execute", async () => {
    const roots: string[] = [];
    const read = defineTool({
      name: "read_file",
      description: "read",
      inputSchema: z.object({ path: z.string() }),
      async execute({ path }) {
        return { content: `ok:${path}` };
      },
    });
    const gate = createPermissionGate(() => ({
      action: "ask",
      reason: "need root",
      grantRoot: "/tmp/granted-root",
    }));
    gate.setAsk(async (req) => {
      if (req.grantRoot) roots.push(req.grantRoot);
      return "allow";
    });

    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [{ name: "read_file", arguments: { path: "../x" } }],
        },
        { text: "read done" },
      ]),
      tools: gate.wrap([read]),
    });

    const result = await agent.run("read outside");
    expect(roots).toEqual(["/tmp/granted-root"]);
    expect(JSON.stringify(result.messages)).toContain("ok:../x");
  });

  it("treats ask without an approver as deny", async () => {
    const gate = createPermissionGate(() => ({
      action: "ask",
      reason: "need approval",
    }));
    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [{ name: "bash", arguments: { command: "id" } }],
        },
        { text: "ok" },
      ]),
      tools: gate.wrap([
        defineTool({
          name: "bash",
          description: "run",
          inputSchema: z.object({ command: z.string() }),
          async execute() {
            return { content: "ran" };
          },
        }),
      ]),
    });

    const result = await agent.run("go");
    expect(JSON.stringify(result.messages)).toContain("Permission denied");
    expect(JSON.stringify(result.messages)).toContain("no interactive approver");
    expect(JSON.stringify(result.messages)).not.toContain('"ran"');
  });
});
