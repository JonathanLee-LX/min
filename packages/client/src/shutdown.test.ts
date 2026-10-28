import {
  assistantMessage,
  createAgent,
  defineTool,
  mockProvider,
  toolCallPart,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
} from "@min-agent/core";
import {
  createFsStore,
  createSession,
  type SessionSnapshot,
} from "@min-agent/session";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createClient, getClientHost } from "./client.js";

describe("client shutdown snapshot", () => {
  it("does not call onBeforeShutdown when a turn persists normally", async () => {
    let calls = 0;
    const client = await createClient({
      cwd: process.cwd(),
      provider: mockProvider([{ text: "ok" }]),
      noTools: true,
      noSessionStore: true,
      onBeforeShutdown() {
        calls += 1;
      },
    });
    await client.send("hi");
    expect(calls).toBe(0);
    await client.dispose();
  });

  it("writes the partial turn before exit and skips thinking", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "min-stop-"));
    const order: string[] = [];
    let seen: SessionSnapshot | undefined;
    try {
      const provider = stalledProvider();
      const note = defineTool({
        name: "note",
        description: "note",
        inputSchema: z.object({}),
        async execute() {
          return { content: "noted" };
        },
      });
      const agent = await createAgent({ provider, tools: [note], maxTurns: 4 });
      const store = createFsStore(dir);
      const session = await createSession({
        agent,
        id: "ses_stop",
        store,
        hooks: {
          onBeforeSave(snapshot) {
            order.push("save");
            return snapshot;
          },
        },
      });
      const client = await createClient({
        runtime: {
          agent,
          session,
          store,
          cwd: dir,
        } as never,
        onBeforeShutdown(snapshot) {
          order.push("hook");
          seen = snapshot;
        },
      });
      const events: string[] = [];
      client.subscribe((event) => events.push(event.type));

      const sending = client.send("please");
      await waitFor(() => events.includes("assistant_delta"));
      client.queue.push("later");
      await getClientHost(client).shutdown({ hookTimeoutMs: 1_000 });
      await sending.catch(() => undefined);

      expect(order[0]).toBe("hook");
      expect(order).toContain("save");
      const raw = await readFile(path.join(dir, "ses_stop.json"), "utf8");
      expect(raw).toContain("please");
      expect(raw).toContain("noted");
      expect(raw).toContain("Hello");
      expect(raw).toContain("later");
      expect(raw).not.toContain("secret-thought");
      expect(seen?.messages.some((message) => message.role === "user")).toBe(true);
      expect(JSON.stringify(seen?.messages)).not.toContain("secret-thought");
      expect(session.id).toBe("ses_stop");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("continues after the shutdown hook times out", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "min-stop-timeout-"));
    try {
      const client = await createClient({
        cwd: dir,
        provider: mockProvider([{ text: "ok" }]),
        noTools: true,
        sessionDir: dir,
        sessionId: "ses_timeout",
        onBeforeShutdown() {
          return new Promise(() => undefined);
        },
      });
      await client.send("hi");
      const started = Date.now();
      await getClientHost(client).shutdown({ hookTimeoutMs: 40 });
      expect(Date.now() - started).toBeLessThan(2_000);
      const raw = await readFile(path.join(dir, "ses_timeout.json"), "utf8");
      expect(raw).toContain("hi");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function stalledProvider(): ModelProvider {
  let phase = 0;
  const finish = (text: string, tool?: boolean): CompletionResult => ({
    message: tool
      ? assistantMessage([toolCallPart("c1", "note", {})])
      : assistantMessage([{ type: "text", text }]),
    stopReason: tool ? "tool_use" : "end",
  });
  const provider: ModelProvider = {
    id: "stall",
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      phase += 1;
      return finish(phase === 1 ? "" : "Hello", phase === 1);
    },
    async *stream(req: CompletionRequest) {
      phase += 1;
      if (phase === 1) {
        yield { type: "done", result: finish("", true) };
        return;
      }
      yield { type: "thinking_delta", text: "secret-thought" };
      yield { type: "text_delta", text: "Hello" };
      await new Promise<void>((_resolve, reject) => {
        const fail = () => reject(new DOMException("aborted", "AbortError"));
        if (req.signal?.aborted) {
          fail();
          return;
        }
        req.signal?.addEventListener("abort", fail, { once: true });
      });
    },
  };
  return provider;
}

async function waitFor(pred: () => boolean, ms = 3_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
