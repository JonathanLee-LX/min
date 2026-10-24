import {
  createAgent,
  defineTool,
  mockProvider,
} from "@min/core";
import { createMemoryStore, createSession } from "@min/session";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createClient } from "./client.js";
import type { ClientEvent } from "./types.js";

function eventTypes(events: ClientEvent[]): string[] {
  return events.map((e) =>
    e.type === "status" ? `status:${e.status}` : e.type,
  );
}

describe("Client golden paths", () => {
  it("freezes stream event order: running → deltas → done → session → idle", async () => {
    const events: ClientEvent[] = [];
    const client = await createClient({
      cwd: process.cwd(),
      provider: mockProvider([{ text: "Hello world" }]),
      noTools: true,
      noSessionStore: true,
    });
    client.subscribe((e) => events.push(e));

    await client.send("hi");

    const types = eventTypes(events);
    expect(types[0]).toBe("status:running");
    expect(types.filter((t) => t === "assistant_delta").length).toBeGreaterThan(
      0,
    );
    expect(types).toContain("assistant_done");
    expect(types).toContain("session");
    expect(types.at(-1)).toBe("status:idle");

    const done = events.find((e) => e.type === "assistant_done");
    expect(done).toMatchObject({ type: "assistant_done", text: "Hello world" });
    const session = events.find((e) => e.type === "session");
    expect(session).toMatchObject({ type: "session", reason: "update" });
    expect(client.getStatus().status).toBe("idle");
    await client.dispose();
  });

  it("emits tool_start → tool_end around a tool call", async () => {
    const bash = defineTool({
      name: "bash",
      description: "run",
      inputSchema: z.object({ command: z.string() }),
      async execute() {
        return { content: "tool-ok" };
      },
    });
    const agent = await createAgent({
      provider: mockProvider([
        { toolCalls: [{ name: "bash", arguments: { command: "echo" } }] },
        { text: "finished" },
      ]),
      tools: [bash],
      permissionHandler: () => ({ action: "allow" }),
    });
    const session = await createSession({
      agent,
      store: createMemoryStore(),
    });
    const events: ClientEvent[] = [];
    const client = await createClient({
      runtime: {
        agent,
        session,
        store: undefined,
        permissions: undefined,
        cwd: process.cwd(),
      } as never,
    });
    client.subscribe((e) => events.push(e));
    await client.send("run");

    const types = eventTypes(events);
    const start = types.indexOf("tool_start");
    const end = types.indexOf("tool_end");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(types).toContain("assistant_done");
    await client.dispose();
  });

  it("permission path: asking → respond → running → done", async () => {
    const bash = defineTool({
      name: "bash",
      description: "run",
      inputSchema: z.object({ command: z.string() }),
      async execute() {
        return { content: "ok" };
      },
    });
    const agent = await createAgent({
      provider: mockProvider([
        { toolCalls: [{ name: "bash", arguments: { command: "id" } }] },
        { text: "allowed" },
      ]),
      tools: [bash],
      permissionHandler: () => ({ action: "ask", reason: "confirm bash" }),
    });
    const session = await createSession({ agent, store: createMemoryStore() });
    const events: ClientEvent[] = [];
    const client = await createClient({
      runtime: {
        agent,
        session,
        store: undefined,
        permissions: undefined,
        cwd: process.cwd(),
      } as never,
      permissionTimeoutMs: 5_000,
    });
    client.subscribe((e) => events.push(e));

    const sending = client.send("please run");
    await waitFor(() => events.some((e) => e.type === "permission"));
    expect(eventTypes(events)).toContain("status:asking");
    const perm = events.find((e) => e.type === "permission");
    expect(perm?.type).toBe("permission");
    if (perm?.type === "permission") {
      client.respondPermission(perm.id, "allow");
    }
    await sending;

    const types = eventTypes(events);
    const askIdx = types.indexOf("status:asking");
    const runAgain = types.indexOf("status:running", askIdx + 1);
    expect(askIdx).toBeGreaterThanOrEqual(0);
    expect(runAgain).toBeGreaterThan(askIdx);
    expect(types).toContain("assistant_done");
    expect(types.at(-1)).toBe("status:idle");
    await client.dispose();
  });

  it("follow_up after queue drain on owned runtime", async () => {
    const provider = mockProvider([{ text: "first" }, { text: "second" }]);
    const events: ClientEvent[] = [];
    let queued = false;
    const client = await createClient({
      cwd: process.cwd(),
      provider,
      noTools: true,
      noSessionStore: true,
    });
    client.subscribe((e) => {
      events.push(e);
      // Queue during the first pass so Session drains after it returns.
      if (e.type === "assistant_delta" && !queued) {
        queued = true;
        client.queue.push("extra context");
      }
    });

    await client.send("a");

    expect(events.some((e) => e.type === "queued")).toBe(true);
    const follow = events.find((e) => e.type === "follow_up");
    expect(follow).toMatchObject({
      type: "follow_up",
      texts: ["extra context"],
    });
    const types = eventTypes(events);
    const doneIdx = types
      .map((t, i) => (t === "assistant_done" ? i : -1))
      .filter((i) => i >= 0);
    expect(doneIdx.length).toBe(2);
    const followIdx = types.indexOf("follow_up");
    expect(doneIdx[0]).toBeLessThan(followIdx);
    expect(doneIdx[1]).toBeGreaterThan(followIdx);
    await client.dispose();
  });

  it("abort emits aborted error and returns to idle", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const provider = mockProvider([{ text: "slow" }]);
    const original = provider.complete.bind(provider);
    provider.complete = async (req) => {
      await gate;
      return original(req);
    };
    provider.stream = async function* (req) {
      await gate;
      const result = await original(req);
      yield { type: "text_delta" as const, text: "slow" };
      yield { type: "done" as const, result };
    };

    const events: ClientEvent[] = [];
    const client = await createClient({
      cwd: process.cwd(),
      provider,
      noTools: true,
      noSessionStore: true,
    });
    client.subscribe((e) => events.push(e));

    const sending = client.send("go");
    await waitFor(() => client.getStatus().status === "running");
    client.abort();
    release();
    await sending;

    expect(
      events.some((e) => e.type === "error" && e.aborted === true),
    ).toBe(true);
    expect(client.getStatus().status).toBe("idle");
    await client.dispose();
  });
});

describe("Client session surface", () => {
  it("listSessions / openSession / newSession with transcript replay", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "min-client-ses-"));
    try {
      const client = await createClient({
        cwd: process.cwd(),
        provider: mockProvider([{ text: "alpha" }, { text: "beta" }]),
        noTools: true,
        sessionDir: dir,
      });
      const events: ClientEvent[] = [];
      client.subscribe((e) => events.push(e));

      await client.send("first turn");
      const idA = client.getSession().id;
      expect(idA).toBeTruthy();

      await client.newSession();
      const newEv = events.filter((e) => e.type === "session").at(-1);
      expect(newEv).toMatchObject({
        type: "session",
        reason: "new",
        messageCount: 0,
      });
      expect(newEv && "messages" in newEv && newEv.messages).toEqual([]);
      const idB = client.getSession().id;
      expect(idB).not.toBe(idA);

      await client.send("second session");
      const listed = await client.listSessions();
      expect(listed.map((m) => m.id).sort()).toEqual([idA, idB].sort());

      await client.openSession(idA);
      const openEv = events.filter((e) => e.type === "session").at(-1);
      expect(openEv).toMatchObject({
        type: "session",
        reason: "open",
        id: idA,
      });
      expect(
        openEv && "messages" in openEv ? openEv.messages?.length : 0,
      ).toBeGreaterThan(0);
      expect(client.getSession().id).toBe(idA);
      expect(client.getSession().messageCount).toBeGreaterThan(0);

      client.reset();
      const resetEv = events.filter((e) => e.type === "session").at(-1);
      expect(resetEv).toMatchObject({
        type: "session",
        reason: "reset",
        messageCount: 0,
      });

      await client.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}
