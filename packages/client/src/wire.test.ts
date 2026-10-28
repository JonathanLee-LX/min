import {
  createAgent,
  defineTool,
  mockProvider,
  type CompletionRequest,
  type ModelProvider,
} from "@min-agent/core";
import { createMemoryStore, createSession } from "@min-agent/session";
import { createPermissionGate } from "@min-agent/tools";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createClient } from "./client.js";
import { connectRemote } from "./remote.js";
import type { ClientEvent } from "./types.js";
import { serveClient } from "./wire.js";

describe("session socket", () => {
  it("gives two frontends one event stream and broadcasts the permission answer", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "min-wire-"));
    const socketPath = path.join(dir, "client.sock");
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
    const client = await createClient({
      runtime: {
        agent,
        session,
        cwd: dir,
      } as never,
    });
    const server = await serveClient({
      client,
      socketPath,
      buildVersion: "test",
    });
    const leftEvents: ClientEvent[] = [];
    const rightEvents: ClientEvent[] = [];
    try {
      const left = await connectRemote(socketPath);
      const right = await connectRemote(socketPath);
      left.subscribe((event) => leftEvents.push(event));
      right.subscribe((event) => rightEvents.push(event));
      const sending = left.send("run");
      await waitFor(() =>
        leftEvents.some((event) => event.type === "permission"),
      );
      await waitFor(() =>
        rightEvents.some((event) => event.type === "permission"),
      );
      const perm = rightEvents.find((event) => event.type === "permission");
      expect(perm?.type).toBe("permission");
      if (perm?.type === "permission") {
        right.respondPermission(perm.id, "allow");
      }
      await sending;
      await waitFor(
        () =>
          leftEvents.some(
            (event) =>
              event.type === "permission_decision" && event.answer === "allow",
          ) &&
          rightEvents.some(
            (event) =>
              event.type === "permission_decision" && event.answer === "allow",
          ),
      );
      await waitFor(
        () =>
          leftEvents.some((event) => event.type === "assistant_done") &&
          rightEvents.some((event) => event.type === "assistant_done"),
      );
      left.close();
      right.close();
    } finally {
      await server.close();
      await client.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("hands off the in-flight turn before later deltas", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "min-wire-handoff-"));
    const socketPath = path.join(dir, "client.sock");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: ModelProvider = {
      id: "slow",
      async complete() {
        return {
          message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
          stopReason: "end",
        };
      },
      async *stream(req: CompletionRequest) {
        yield { type: "thinking_delta", text: "secret-thought" };
        await gate;
        if (req.signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        yield { type: "text_delta", text: "Hello" };
        yield { type: "text_delta", text: " world" };
        yield {
          type: "done",
          result: {
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Hello world" }],
            },
            stopReason: "end",
          },
        };
      },
    };
    const client = await createClient({
      cwd: dir,
      provider,
      noTools: true,
      noSessionStore: true,
    });
    const server = await serveClient({
      client,
      socketPath,
      buildVersion: "test",
    });
    try {
      const first = await connectRemote(socketPath);
      const seen: ClientEvent[] = [];
      first.subscribe((event) => seen.push(event));
      const sending = first.send("hi");
      await waitFor(() =>
        seen.some((event) => event.type === "thinking_delta"),
      );
      const second = await connectRemote(socketPath);
      expect(second.handoff.turn.text).toBe("");
      expect(second.handoff.turn.thinking).toBe("secret-thought");
      expect(second.handoff.turn.userText).toBe("hi");
      const later: ClientEvent[] = [];
      second.subscribe((event) => later.push(event));
      release();
      await sending;
      const deltas = later
        .filter((event) => event.type === "assistant_delta")
        .map((event) => (event.type === "assistant_delta" ? event.text : ""))
        .join("");
      expect(deltas).toBe("Hello world");
      expect(second.handoff.turn.thinking).not.toBe("");
      first.close();
      second.close();
    } finally {
      release();
      await server.close();
      await client.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function waitFor(pred: () => boolean, ms = 3_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
