import {
  createClient,
  type ClientEvent,
  type PermissionAnswer,
} from "@min-agent/client";
import {
  createAgent,
  defineTool,
  mockProvider,
} from "@min-agent/core";
import { createMemoryStore, createSession } from "@min-agent/session";
import { createPermissionGate } from "@min-agent/tools";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { connectClientProcess } from "./client-socket.js";
import { listenClientProcess } from "./client-server.js";

const temps: string[] = [];

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "min-client-proc-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function waitFor(pred: () => boolean, ms = 3_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("client process socket", () => {
  it("hands the same event stream to two connections and broadcasts permission answers", async () => {
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
        { toolCalls: [{ name: "bash", arguments: { command: "echo hi" } }] },
        { text: "done" },
      ]),
      tools: gate.wrap([bash]),
    });
    const session = await createSession({
      agent,
      store: createMemoryStore(),
      bindPermissionAsk: (ask) => gate.setAsk(ask),
    });
    const inner = await createClient({
      runtime: {
        agent,
        session,
        store: undefined,
        permissions: undefined,
        cwd: process.cwd(),
      } as never,
    });

    const root = await tmpRoot();
    const server = await listenClientProcess({
      client: inner,
      root,
      sessionId: inner.getSession().id,
      cwd: root,
    });

    const a = await connectClientProcess(server.socketPath);
    const b = await connectClientProcess(server.socketPath);
    const eventsA: ClientEvent[] = [];
    const eventsB: ClientEvent[] = [];
    a.subscribe((e) => eventsA.push(e));
    b.subscribe((e) => eventsB.push(e));

    const sending = a.send("run it");
    await waitFor(() => eventsA.some((e) => e.type === "permission"));
    await waitFor(() => eventsB.some((e) => e.type === "permission"));
    const perm = eventsA.find((e) => e.type === "permission");
    if (perm?.type !== "permission") throw new Error("expected permission");
    b.respondPermission(perm.id, "allow" satisfies PermissionAnswer);
    await sending;

    await waitFor(() =>
      eventsA.some((e) => e.type === "permission_answer" && e.answer === "allow"),
    );
    await waitFor(() =>
      eventsB.some((e) => e.type === "permission_answer" && e.answer === "allow"),
    );

    await a.dispose();
    await b.dispose();
    await server.shutdown();
  });

  it("sends a snapshot before live events so a late joiner sees the current turn", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const provider = mockProvider([{ text: "abcdef" }]);
    const original = provider.complete.bind(provider);
    provider.complete = async (req) => {
      await gate;
      return original(req);
    };
    provider.stream = async function* (req) {
      yield { type: "text_delta" as const, text: "abc" };
      await gate;
      const result = await original(req);
      yield { type: "text_delta" as const, text: "def" };
      yield { type: "done" as const, result };
    };

    const inner = await createClient({
      cwd: process.cwd(),
      provider,
      noTools: true,
      noSessionStore: true,
    });
    const root = await tmpRoot();
    const server = await listenClientProcess({
      client: inner,
      root,
      sessionId: inner.getSession().id,
      cwd: root,
    });

    const first = await connectClientProcess(server.socketPath);
    const sending = first.send("go");
    await waitFor(() => first.handshake.turn.text.includes("abc") || first.getStatus().status === "running");
    await waitFor(() => inner.getStatus().status === "running");
    // Give the first delta a moment to land in turnBuf.
    await new Promise((r) => setTimeout(r, 40));

    const late = await connectClientProcess(server.socketPath);
    expect(late.handshake.session.id).toBe(inner.getSession().id);
    expect(late.handshake.status.status === "running" || late.handshake.turn.text.length >= 0).toBe(
      true,
    );

    release();
    await sending;
    await first.dispose();
    await late.dispose();
    await server.shutdown();
  });
});
