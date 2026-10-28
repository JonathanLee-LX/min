import {
  createAgent,
  defineTool,
  mockProvider,
} from "@min-agent/core";
import { createRuntime } from "@min-agent/runtime";
import { createMemoryStore, createSession } from "@min-agent/session";
import { createPermissionGate } from "@min-agent/tools";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  clientHandshake,
  createClient,
  shutdownClient,
} from "./client.js";
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

  it("broadcasts permission_answer when respondPermission wins", async () => {
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
    if (perm?.type !== "permission") throw new Error("expected permission");
    client.respondPermission(perm.id, "allow");
    await sending;
    expect(
      events.some(
        (e) =>
          e.type === "permission_answer" &&
          e.id === perm.id &&
          e.answer === "allow",
      ),
    ).toBe(true);
    await client.dispose();
  });

  it("shutdown snapshot includes the user turn, frozen assistant text, and queue", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const provider = mockProvider([{ text: "hello world" }]);
    const original = provider.complete.bind(provider);
    provider.complete = async (req) => {
      await gate;
      return original(req);
    };
    provider.stream = async function* (req) {
      yield { type: "text_delta" as const, text: "hello" };
      await gate;
      const result = await original(req);
      yield { type: "text_delta" as const, text: " world" };
      yield { type: "done" as const, result };
    };

    const hooks: string[] = [];
    const client = await createClient({
      cwd: process.cwd(),
      provider,
      noTools: true,
      noSessionStore: true,
      onBeforeShutdown(snapshot) {
        hooks.push(snapshot.meta.id);
      },
    });
    const sending = client.send("please write");
    await waitFor(() => clientHandshake(client).turn.text.includes("hello"));
    client.queue.push("queued later");
    const sessionId = client.getSession().id;
    const snap = await shutdownClient(client);
    expect(
      snap.messages.some(
        (m) =>
          m.role === "user" &&
          m.content.some((p) => p.type === "text" && p.text === "please write"),
      ),
    ).toBe(true);
    expect(
      snap.messages.some(
        (m) =>
          m.role === "assistant" &&
          m.content.some((p) => p.type === "text" && p.text.includes("hello")),
      ),
    ).toBe(true);
    expect(
      snap.messages.some(
        (m) =>
          m.role === "user" &&
          m.content.some((p) => p.type === "text" && p.text === "queued later"),
      ),
    ).toBe(true);
    expect(hooks).toEqual([sessionId]);
    release();
    await sending;
  });

  it("writes the frozen turn to the session file on shutdown", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "min-shut-"));
    try {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const provider = mockProvider([{ text: "partial" }]);
      const original = provider.complete.bind(provider);
      provider.complete = async (req) => {
        await gate;
        return original(req);
      };
      provider.stream = async function* (req) {
        yield { type: "text_delta" as const, text: "partial" };
        await gate;
        const result = await original(req);
        yield { type: "done" as const, result };
      };
      const client = await createClient({
        cwd: process.cwd(),
        provider,
        noTools: true,
        sessionDir: dir,
        sessionId: "ses_frozen",
      });
      const sending = client.send("user says hi");
      await waitFor(() => clientHandshake(client).turn.text.includes("partial"));
      await shutdownClient(client);
      release();
      await sending;
      const raw = await readFile(path.join(dir, "ses_frozen.json"), "utf8");
      const snap = JSON.parse(raw) as {
        messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
      };
      const texts = snap.messages.flatMap((m) =>
        m.content.filter((p) => p.type === "text").map((p) => `${m.role}:${p.text}`),
      );
      expect(texts.some((t) => t === "user:user says hi")).toBe(true);
      expect(texts.some((t) => t.startsWith("assistant:") && t.includes("partial"))).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("handshake includes live turn text without writing thinking", async () => {
    const client = await createClient({
      cwd: process.cwd(),
      provider: mockProvider([{ text: "ready" }]),
      noTools: true,
      noSessionStore: true,
    });
    const hs = clientHandshake(client);
    expect(hs.session.id).toBe(client.getSession().id);
    expect(hs.status.status).toBe("idle");
    expect(hs.turn).toEqual({ text: "", thinking: "" });
    expect(hs.pendingPermissions).toEqual([]);
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
