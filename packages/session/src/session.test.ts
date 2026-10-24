import {
  assistantMessage,
  createAgent,
  mockProvider,
  textPart,
  toolCallPart,
  toolMessage,
  toolResultPart,
  userMessage,
} from "@min/core";
import { describe, expect, it, vi } from "vitest";
import { createInputQueue } from "./input-queue.js";
import { createSession } from "./session.js";
import { createMemoryStore } from "./store.js";

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

  it("trims model view but keeps full history after overflow", async () => {
    const agent = await createAgent({
      provider: mockProvider([
        { text: "r1" },
        { text: "r2" },
        { text: "r3" },
      ]),
    });

    const session = await createSession({
      agent,
      budget: {
        maxContextTokens: 200,
        reservedOutputTokens: 80,
        fold: false,
      },
    });

    await session.run("A".repeat(800));
    await session.run("B".repeat(800));
    await session.run("C".repeat(800));

    expect(session.messages.filter((m) => m.role === "user").length).toBe(3);
    expect(session.lastAssemble?.trimmed).toBe(true);
    await agent.dispose();
  });

  it("folds tool results in the model view without rewriting store", async () => {
    const blob = "B".repeat(12_000);
    const toolMsg = toolMessage([toolResultPart("c1", blob)]);
    const agent = await createAgent({
      provider: mockProvider([{ text: "done" }]),
    });

    const session = await createSession({
      agent,
      initialMessages: [
        userMessage("earlier"),
        assistantMessage([toolCallPart("c1", "read_file", { path: "x" })]),
        toolMsg,
      ],
      budget: {
        maxContextTokens: 100_000,
        fold: {
          maxToolResultChars: 800,
          toolResultHeadChars: 80,
          toolResultTailChars: 80,
        },
      },
    });

    await session.run("continue");
    const stored = session.messages.find((m) => m.role === "tool");
    expect(stored?.content[0]?.type).toBe("tool_result");
    if (stored?.content[0]?.type === "tool_result") {
      expect(stored.content[0].content).toBe(blob);
    }
    expect(session.lastAssemble?.foldedParts).toBeGreaterThan(0);
    const viewTool = session.lastAssemble?.view.find((m) => m.role === "tool");
    if (viewTool?.content[0]?.type === "tool_result") {
      expect(viewTool.content[0].content.length).toBeLessThan(blob.length);
    }
    await agent.dispose();
  });
});
