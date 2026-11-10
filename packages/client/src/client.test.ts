import {
  createAgent,
  defineTool,
  mockProvider,
} from "@min-agent/core";
import { createRuntime } from "@min-agent/runtime";
import { createMemoryStore, createSession } from "@min-agent/session";
import { createPermissionGate } from "@min-agent/tools";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createClient } from "./client.js";
import type { ClientEvent } from "./types.js";

describe("createClient", () => {
  it("streams assistant events and settles idle", async () => {
    const events: ClientEvent[] = [];
    const client = await createClient({
      cwd: process.cwd(),
      provider: mockProvider([{ text: "Hello" }]),
      noTools: true,
      noSessionStore: true,
    });
    client.subscribe((e) => events.push(e));

    await client.send("hi");

    expect(events.some((e) => e.type === "status" && e.status === "running")).toBe(
      true,
    );
    expect(events.some((e) => e.type === "assistant_delta")).toBe(true);
    expect(
      events.some((e) => e.type === "assistant_done" && e.text === "Hello"),
    ).toBe(true);
    const context = events.find((e) => e.type === "context");
    expect(context?.type).toBe("context");
    if (context?.type === "context") {
      expect(context.usage.limit).toBeGreaterThan(0);
      expect(context.usage.parts.some((part) => part.id === "conversation")).toBe(
        true,
      );
    }
    expect(client.getStatus().context?.used).toBeGreaterThan(0);
    expect(client.getStatus().status).toBe("idle");
    await client.dispose();
  });

  it("queues send while busy", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const provider = mockProvider([{ text: "one" }]);
    const original = provider.complete.bind(provider);
    provider.complete = async (req) => {
      await gate;
      return original(req);
    };
    provider.stream = async function* (req) {
      await gate;
      const result = await original(req);
      for (const part of result.message.content) {
        if (part.type === "text" && part.text) {
          yield { type: "text_delta" as const, text: part.text };
        }
      }
      yield { type: "done" as const, result };
    };

    const client = await createClient({
      cwd: process.cwd(),
      provider,
      noTools: true,
      noSessionStore: true,
    });

    const first = client.send("a");
    await new Promise((r) => setTimeout(r, 20));
    await client.send("follow-up");
    expect(client.queue.size).toBe(1);
    expect(client.queue.peek()).toEqual(["follow-up"]);
    release();
    await first;
    await client.dispose();
  });

  it("sends attachments on SendOptions without changing send arity", async () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const client = await createClient({
      cwd: process.cwd(),
      provider: mockProvider([{ text: "ok" }]),
      noTools: true,
      noSessionStore: true,
    });
    await client.send("look", {
      attachments: [{ filename: "shot.png", bytes: png }],
    });
    const user = client.getSession().messages.find((message) => message.role === "user");
    expect(user?.content.some((part) => part.type === "image")).toBe(true);
    expect(client.send.length).toBe(1);
    await client.dispose();
  });

  it("rejects attachments while busy instead of queueing them", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const provider = mockProvider([{ text: "one" }]);
    const original = provider.complete.bind(provider);
    provider.complete = async (req) => {
      await gate;
      return original(req);
    };
    provider.stream = async function* (req) {
      await gate;
      const result = await original(req);
      for (const part of result.message.content) {
        if (part.type === "text" && part.text) {
          yield { type: "text_delta" as const, text: part.text };
        }
      }
      yield { type: "done" as const, result };
    };
    const client = await createClient({
      cwd: process.cwd(),
      provider,
      noTools: true,
      noSessionStore: true,
    });
    const first = client.send("a");
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      client.send("x", { attachments: [{ filename: "shot.png", bytes: png }] }),
    ).rejects.toThrow(/attachments while busy/);
    expect(client.queue.peek()).toEqual([]);
    release();
    await first;
    await client.dispose();
  });

  it("permission bridge waits for respondPermission", async () => {
    const bash = defineTool({
      name: "bash",
      description: "run",
      inputSchema: z.object({ command: z.string() }),
      async execute() {
        return { content: "ok" };
      },
    });

    const gate = createPermissionGate(() => ({
      action: "ask",
      reason: "need bash",
    }));
    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [{ name: "bash", arguments: { command: "echo hi" } }],
        },
        { text: "done" },
      ]),
      tools: gate.wrap([bash]),
    });

    const session = await createSession({
      agent,
      store: createMemoryStore(),
      bindPermissionAsk: (ask) => gate.setAsk(ask),
    });

    const runtime = {
      agent,
      session,
      store: undefined,
      permissions: undefined,
      cwd: process.cwd(),
    };

    const events: ClientEvent[] = [];
    const client = await createClient({ runtime: runtime as never });
    client.subscribe((e) => events.push(e));

    const sending = client.send("run something");
    await waitFor(() => events.some((e) => e.type === "permission"));
    const perm = events.find((e) => e.type === "permission");
    expect(perm?.type).toBe("permission");
    if (perm?.type === "permission") {
      client.respondPermission(perm.id, "allow");
    }
    await sending;
    expect(events.some((e) => e.type === "assistant_done")).toBe(true);
    await client.dispose();
  });

  it("accepts injected runtime from createRuntime", async () => {
    const rt = await createRuntime({
      cwd: process.cwd(),
      provider: mockProvider([{ text: "x" }]),
      noTools: true,
      noSessionStore: true,
    });
    const client = await createClient({ runtime: rt });
    expect(client.getStatus().provider).toBe("mock");
    expect(client.advanced.runtime).toBe(rt);
    await client.send("ping");
    expect(client.getSession().messageCount).toBeGreaterThan(0);
    await client.dispose();
  });

  it("loads a skill when send starts with /name", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "min-client-skill-"));
    const skillDir = path.join(cwd, "skills", "greeter");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: greeter",
        "description: Greet the user.",
        "---",
        "",
        "Say hello warmly.",
        "",
      ].join("\n"),
    );
    const provider = mockProvider([{ text: "hi" }]);
    const client = await createClient({
      cwd,
      home: cwd,
      provider,
      noTools: true,
      noSessionStore: true,
      skillsDir: path.join(cwd, "skills"),
    });
    expect(client.listSkills().map((skill) => skill.name)).toEqual(["greeter"]);
    await client.send("/greeter hello");
    expect(provider.calls[0]?.system).toContain("Say hello warmly.");
    const user = client.getSession().messages.find((message) => message.role === "user");
    expect(user?.content.some((part) => part.type === "text" && part.text === "/greeter hello")).toBe(
      true,
    );
    await client.dispose();
  });
});

async function waitFor(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}
