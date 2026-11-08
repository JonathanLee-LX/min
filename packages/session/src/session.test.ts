import {
  assistantMessage,
  createAgent,
  defineTool,
  mockProvider,
  textPart,
  toolCallPart,
  toolMessage,
  toolResultPart,
  userMessage,
} from "@min-agent/core";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createFsBlobStore } from "./blobs.js";
import { createInputQueue } from "./input-queue.js";
import { PNG_SIG } from "./media.fixtures.js";
import { createSession } from "./session.js";
import { hmtContextExtension, hybridContextExtension } from "./strategies.js";
import { createFsStore, createMemoryStore } from "./store.js";

describe("createSession", () => {
  it("accumulates canonical history across runs", async () => {
    const agent = await createAgent({
      provider: mockProvider([
        { text: "one" },
        { text: "two" },
      ]),
      system: "test",
    });

    const session = await createSession({ agent });
    await session.run("hi");
    await session.run("again");

    expect(session.messages.filter((m) => m.role === "user")).toHaveLength(2);
    expect(session.messages.at(-1)?.content).toEqual([textPart("two")]);
    await agent.dispose();
  });

  it("persists and reloads via store", async () => {
    const store = createMemoryStore();
    const agent = await createAgent({
      provider: mockProvider([{ text: "saved" }]),
    });
    const session = await createSession({
      agent,
      store,
      id: "ses_test",
    });
    await session.run("persist me");
    await session.dispose();

    const agent2 = await createAgent({
      provider: mockProvider([{ text: "continued" }]),
    });
    const resumed = await createSession({
      agent: agent2,
      store,
      id: "ses_test",
    });
    expect(resumed.messages.some((m) => m.role === "user")).toBe(true);
    await resumed.run("next");
    expect(resumed.messages.filter((m) => m.role === "user")).toHaveLength(2);
    await agent.dispose();
    await agent2.dispose();
  });

  it("drains inputQueue after agent.run without touching core", async () => {
    const incoming = vi.fn();
    const agent = await createAgent({
      provider: mockProvider([{ text: "first" }, { text: "second" }]),
    });
    const queue = createInputQueue({ mode: "enqueue" });
    const session = await createSession({
      agent,
      inputQueue: queue,
      hooks: { onIncoming: incoming },
    });

    // Simulate an interjection arriving while the first pass would be running.
    queue.push("extra detail");

    const result = await session.run("start");
    expect(result.text).toBe("second");
    expect(incoming).toHaveBeenCalledWith(["extra detail"]);
    expect(session.messages.filter((m) => m.role === "user")).toHaveLength(2);
    expect(queue.size).toBe(0);
    await agent.dispose();
  });

  it("trim baseline drops view turns but keeps full canonical history", async () => {
    const agent = await createAgent({
      provider: mockProvider([
        { text: "r1" },
        { text: "r2" },
        { text: "r3" },
        { text: "r4" },
        { text: "r5" },
      ]),
    });

    const session = await createSession({
      agent,
      budget: {
        maxContextTokens: 400,
        reservedOutputTokens: 80,
      },
    });

    await session.run("A".repeat(400));
    await session.run("B".repeat(400));
    await session.run("C".repeat(400));
    await session.run("D".repeat(400));
    await session.run("E".repeat(400));

    expect(session.messages.filter((m) => m.role === "user").length).toBe(5);
    expect(session.lastAssemble?.strategy).toBe("trim");
    expect(session.lastAssemble?.trimmed).toBe(true);
    expect(session.lastAssemble?.dropped.length).toBeGreaterThan(0);
    // View is a suffix; store still has the full conversation.
    expect(session.lastAssemble!.kept!.length).toBeLessThan(
      session.messages.length,
    );
    await agent.dispose();
  });

  it("folds middle tool results when H-M-T extension is plugged in", async () => {
    const blob = "B".repeat(12_000);
    const toolMsg = toolMessage([toolResultPart("c1", blob)]);
    const agent = await createAgent({
      provider: mockProvider([{ text: "done" }]),
    });

    const hmt = hmtContextExtension({
      budget: {
        maxContextTokens: 100_000,
        headTurns: 1,
        tailTurns: 1,
        fold: {
          maxToolResultChars: 800,
          toolResultHeadChars: 80,
          toolResultTailChars: 80,
        },
      },
    });

    const session = await createSession({
      agent,
      stash: hmt.stash,
      extensions: [hmt],
      initialMessages: [
        userMessage("earlier"),
        assistantMessage([textPart("ack")]),
        userMessage("run"),
        assistantMessage([toolCallPart("c1", "read_file", { path: "x" })]),
        toolMsg,
        userMessage("later"),
        assistantMessage([textPart("tail")]),
      ],
    });

    await session.run("continue");
    const stored = session.messages.find((m) => m.role === "tool");
    expect(stored?.content[0]?.type).toBe("tool_result");
    if (stored?.content[0]?.type === "tool_result") {
      expect(stored.content[0].content).toBe(blob);
    }
    expect(session.lastAssemble?.strategy).toBe("hmt");
    expect(session.lastAssemble?.foldedParts).toBeGreaterThan(0);
    expect(session.stash?.has("tool_c1")).toBe(true);
    const viewTool = session.lastAssemble?.view.find((m) => m.role === "tool");
    if (viewTool?.content[0]?.type === "tool_result") {
      expect(viewTool.content[0].content.length).toBeLessThan(blob.length);
    }
    await agent.dispose();
  });

  it("defaults to trim strategy without H-M-T plug-in", async () => {
    const agent = await createAgent({
      provider: mockProvider([{ text: "ok" }]),
    });
    const session = await createSession({ agent });
    await session.run("hi");
    expect(session.lastAssemble?.strategy).toBe("trim");
    expect(session.stash).toBeUndefined();
    await agent.dispose();
  });

  it("compact rewrites canonical history on demand", async () => {
    const provider = mockProvider([
      { text: "a1" },
      { text: "a2" },
      { text: "a3" },
      {
        text: "Objective: chat\nDecisions: none\nConstraints: none\nFacts: prior turns\nOpen threads: none\nRejected: none",
      },
    ]);
    const agent = await createAgent({ provider });
    const session = await createSession({ agent });
    await session.run("one");
    await session.run("two");
    await session.run("three");
    const before = session.messages.length;
    expect(before).toBeGreaterThan(4);

    const result = await session.compact({ keepRecentTurns: 1 });
    expect(result.droppedMessageCount).toBeGreaterThan(0);
    expect(result.keptTurns).toBe(1);
    expect(session.messages.length).toBeLessThan(before);
    expect(session.messages[0]?.role).toBe("assistant");
    expect(
      session.messages[0]?.content[0]?.type === "text" &&
        session.messages[0].content[0].text.includes("[context compact]"),
    ).toBe(true);
    await agent.dispose();
  });

  it("re-projects context mid tool-loop while keeping canonical history full", async () => {
    const blob = "Z".repeat(8_000);
    const provider = mockProvider([
      { toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a" } }] },
      { toolCalls: [{ id: "c2", name: "read_file", arguments: { path: "b" } }] },
      { toolCalls: [{ id: "c3", name: "read_file", arguments: { path: "c" } }] },
      { text: "all done" },
    ]);
    const agent = await createAgent({
      provider,
      tools: [
        defineTool({
          name: "read_file",
          description: "read",
          inputSchema: z.object({ path: z.string() }),
          async execute() {
            return { content: blob };
          },
        }),
      ],
    });

    const budget = {
      maxContextTokens: 4_000,
      fold: {
        maxToolResultChars: 500,
        toolResultHeadChars: 60,
        toolResultTailChars: 60,
      },
    };
    const hybrid = hybridContextExtension({
      budget,
      protectRecentToolResults: 1,
    });

    const assembles: number[] = [];
    const session = await createSession({
      agent,
      stash: hybrid.stash,
      budget,
      extensions: [hybrid],
      hooks: {
        onAfterAssemble({ assemble }) {
          assembles.push(assemble.foldedParts ?? 0);
        },
      },
    });

    const result = await session.run("build something big");
    expect(result.turns).toBe(4);
    // The provider wrapper projects once per model complete (≥ 4), plus the pre-run assemble.
    expect(assembles.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...assembles)).toBeGreaterThan(0);

    const storedTools = session.messages.filter((m) => m.role === "tool");
    expect(storedTools.length).toBe(3);
    for (const m of storedTools) {
      const part = m.content[0];
      expect(part?.type).toBe("tool_result");
      if (part?.type === "tool_result") {
        expect(part.content).toBe(blob);
      }
    }

    const viewTool = session.lastAssemble?.view.find((m) => m.role === "tool");
    expect(viewTool?.content[0]?.type).toBe("tool_result");
    if (viewTool?.content[0]?.type === "tool_result") {
      expect(viewTool.content[0].content.length).toBeLessThan(blob.length);
    }
    expect(session.stash?.size).toBeGreaterThan(0);
    await agent.dispose();
  });

  it("persists image parts as blobId and reloads them", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "min-session-media-"));
    const store = createFsStore(root);
    const blobs = createFsBlobStore(path.join(root, "ses_img", "blobs"));
    const provider = mockProvider([{ text: "saw it" }]);
    const agent = await createAgent({ provider });
    const session = await createSession({
      agent,
      store,
      blobStore: blobs,
      id: "ses_img",
    });
    await session.run("look", {
      attachments: [{ filename: "shot.png", bytes: PNG_SIG }],
    });
    const raw = readFileSync(path.join(root, "ses_img.json"), "utf8");
    expect(raw).toContain('"type": "image"');
    expect(raw).toContain("blobId");
    expect(raw).not.toContain("data:");
    expect(raw).not.toMatch(/base64/i);
    expect(raw).not.toContain(String.fromCharCode(0x89, 0x50, 0x4e, 0x47));
    const user = session.messages.find((message) => message.role === "user");
    const image = user?.content.find((part) => part.type === "image");
    expect(image?.type).toBe("image");
    if (image?.type === "image") {
      expect(image).not.toHaveProperty("data");
      expect(image.filename).toBe("shot.png");
    }
    const hydrated = provider.calls[0]?.messages
      .find((message) => message.role === "user")
      ?.content.find((part) => part.type === "image");
    expect(hydrated?.type).toBe("image");
    if (hydrated?.type === "image") expect(hydrated.data).toEqual(PNG_SIG);
    await session.dispose();

    const agent2 = await createAgent({ provider: mockProvider([{ text: "again" }]) });
    const resumed = await createSession({
      agent: agent2,
      store,
      blobStore: blobs,
      id: "ses_img",
    });
    const again = resumed.messages
      .find((message) => message.role === "user")
      ?.content.find((part) => part.type === "image");
    expect(again?.type).toBe("image");
    if (again?.type === "image") expect(again.blobId).toBe(
      image && image.type === "image" ? image.blobId : "",
    );
    await agent.dispose();
    await agent2.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  it("still no-ops on empty text and no attachments", async () => {
    const provider = mockProvider([{ text: "unused" }]);
    const agent = await createAgent({ provider });
    const session = await createSession({ agent });
    const result = await session.run("   ");
    expect(session.messages).toEqual([]);
    expect(result.turns).toBe(0);
    expect(provider.calls).toHaveLength(0);
    await agent.dispose();
  });

  it("allows an attachments-only user turn", async () => {
    const provider = mockProvider([{ text: "ok" }]);
    const agent = await createAgent({ provider });
    const session = await createSession({ agent });
    await session.run("", {
      attachments: [{ filename: "shot.png", bytes: PNG_SIG }],
    });
    const user = session.messages.find((message) => message.role === "user");
    expect(user?.content.some((part) => part.type === "text")).toBe(false);
    expect(user?.content.some((part) => part.type === "image")).toBe(true);
    expect(session.meta.title).toBe("shot.png");
    const modelUser = provider.calls[0]?.messages.find((message) => message.role === "user");
    expect(modelUser?.content.some((part) => part.type === "image" && part.data)).toBe(
      true,
    );
    await agent.dispose();
  });

  it("keeps queued follow-ups as plain strings", async () => {
    const provider = mockProvider([{ text: "first" }, { text: "second" }]);
    const agent = await createAgent({ provider });
    const queue = createInputQueue({ mode: "enqueue" });
    const session = await createSession({ agent, inputQueue: queue });
    queue.push("extra detail");
    await session.run("look", {
      attachments: [{ filename: "shot.png", bytes: PNG_SIG }],
    });
    const users = session.messages.filter((message) => message.role === "user");
    expect(users).toHaveLength(2);
    expect(users[1]?.content).toEqual([{ type: "text", text: "extra detail" }]);
    expect(queue.size).toBe(0);
    await agent.dispose();
  });

});
