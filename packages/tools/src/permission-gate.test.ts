import { createAgent, defineTool, mockProvider, ToolRegistry } from "@min-agent/core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createPermissionGate } from "./permission-protocol.js";
import type { PermissionContext } from "./permission-protocol.js";

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

  it("passes the runner call id, turn, and messages into the handler", async () => {
    let seen: PermissionContext | undefined;
    const gate = createPermissionGate((ctx) => {
      seen = ctx;
      return { action: "allow" };
    });
    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [
            { id: "call-abc", name: "bash", arguments: { command: "pwd" } },
          ],
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

    await agent.run("go");
    expect(seen?.toolCall).toMatchObject({
      id: "call-abc",
      name: "bash",
      arguments: { command: "pwd" },
    });
    expect(seen?.turn).toBe(1);
    expect(seen?.messages?.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
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

  it("times the tool body and not the permission confirmation", async () => {
    let now = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const gate = createPermissionGate(() => ({ action: "ask", reason: "confirm" }));
      gate.setAsk(async () => {
        now += 5_000;
        return "allow";
      });
      const [wrapped] = gate.wrap([
        defineTool({
          name: "bash",
          description: "run",
          inputSchema: z.object({}),
          async execute() {
            now += 25;
            return { content: "ok" };
          },
        }),
      ]);
      const result = await wrapped!.execute({}, { toolCallId: "c1" });
      expect(result.content).toBe("ok");
      expect(result.durationMs).toBe(25);
    } finally {
      spy.mockRestore();
    }
  });

  it("starts the display clock when the body starts, not during confirmation", async () => {
    const marks: string[] = [];
    const gate = createPermissionGate(() => ({ action: "ask", reason: "confirm" }));
    gate.setAsk(async () => {
      expect(marks).toEqual(["claim"]);
      marks.push("ask");
      return "allow";
    });
    const [wrapped] = gate.wrap([
      defineTool({
        name: "bash",
        description: "run",
        inputSchema: z.object({}),
        async execute() {
          marks.push("body");
          return { content: "ok" };
        },
      }),
    ]);
    const registry = new ToolRegistry();
    registry.register(wrapped!);
    const result = await registry.execute("bash", {}, {
      toolCallId: "c1",
      onBodyStart: {
        claim() {
          marks.push("claim");
        },
        start() {
          marks.push("start");
        },
      },
    });
    expect(result.content).toBe("ok");
    expect(result.durationMs).toBeGreaterThan(0);
    expect(marks).toEqual(["claim", "ask", "start", "body"]);
  });

  it("does not start the display clock when confirmation denies the call", async () => {
    const marks: string[] = [];
    const gate = createPermissionGate(() => ({ action: "ask", reason: "confirm" }));
    gate.setAsk(async () => {
      marks.push("ask");
      return "deny";
    });
    const [wrapped] = gate.wrap([
      defineTool({
        name: "bash",
        description: "run",
        inputSchema: z.object({}),
        async execute() {
          return { content: "ok" };
        },
      }),
    ]);
    const registry = new ToolRegistry();
    registry.register(wrapped!);
    const result = await registry.execute("bash", {}, {
      onBodyStart: {
        claim() {
          marks.push("claim");
        },
        start() {
          marks.push("start");
        },
      },
    });
    expect(marks).toEqual(["claim", "ask"]);
    expect(result.durationMs).toBe(0);
  });

  it("records 0ms when confirmation denies the call before it runs", async () => {
    let now = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const ran = vi.fn();
      const gate = createPermissionGate(() => ({ action: "ask", reason: "confirm" }));
      gate.setAsk(async () => {
        now += 5_000;
        return "deny";
      });
      const [wrapped] = gate.wrap([
        defineTool({
          name: "bash",
          description: "run",
          inputSchema: z.object({}),
          async execute() {
            ran();
            return { content: "ok" };
          },
        }),
      ]);
      const result = await wrapped!.execute({}, { toolCallId: "c1" });
      expect(ran).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.durationMs).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps the time already spent when the tool throws or is cancelled", async () => {
    let now = 100;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      const gate = createPermissionGate(() => ({ action: "allow" }));
      const [boom] = gate.wrap([
        defineTool({
          name: "boom",
          description: "throws",
          inputSchema: z.object({}),
          async execute() {
            now += 18;
            throw new Error("nope");
          },
        }),
      ]);
      const failed = await boom!.execute({}, { toolCallId: "err" });
      expect(failed.isError).toBe(true);
      expect(failed.content).toContain("nope");
      expect(failed.durationMs).toBe(18);

      const ac = new AbortController();
      now = 1_000;
      const [hang] = gate.wrap([
        defineTool({
          name: "hang",
          description: "hang",
          inputSchema: z.object({}),
          async execute() {
            now += 40;
            ac.abort();
            now += 1_000;
            return { content: "finished" };
          },
        }),
      ]);
      const cancelled = await hang!.execute({}, { signal: ac.signal, toolCallId: "cancel" });
      expect(cancelled).toMatchObject({ content: "aborted", isError: true, durationMs: 40 });
    } finally {
      spy.mockRestore();
    }
  });

  it("times overlapping calls separately", async () => {
    const gate = createPermissionGate(() => ({ action: "allow" }));
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const [fast, slow] = gate.wrap([
      defineTool({
        name: "fast",
        description: "fast",
        inputSchema: z.object({}),
        async execute() {
          await pause(20);
          return { content: "fast" };
        },
      }),
      defineTool({
        name: "slow",
        description: "slow",
        inputSchema: z.object({}),
        async execute() {
          await pause(80);
          return { content: "slow" };
        },
      }),
    ]);
    const [fastResult, slowResult] = await Promise.all([
      fast!.execute({}, { toolCallId: "fast" }),
      slow!.execute({}, { toolCallId: "slow" }),
    ]);
    expect(fastResult.durationMs).toBeGreaterThan(0);
    expect(slowResult.durationMs).toBeGreaterThan(fastResult.durationMs!);
    expect(fastResult.content).toBe("fast");
    expect(slowResult.content).toBe("slow");
  });
});
