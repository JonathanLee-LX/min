import { createAgent, mockProvider, userMessage } from "@min-agent/core";
import { describe, expect, it, vi } from "vitest";
import { defineSessionExtension } from "./extension.js";
import { createSession } from "./session.js";
import { createMemoryStore } from "./store.js";

describe("session extensions", () => {
  it("runs hooks and allows custom assembler via extension", async () => {
    const before = vi.fn();
    const afterAssemble = vi.fn();
    const afterRun = vi.fn();
    const beforeSave = vi.fn((snap) => snap);

    const agent = await createAgent({
      provider: mockProvider([{ text: "ok" }]),
    });

    const ext = defineSessionExtension({
      name: "test-ext",
      assembler: {
        assemble(input) {
          // Keep only the last message in the view; drop the rest.
          const view = input.messages.slice(-1);
          return {
            view,
            dropped: input.messages.slice(0, -1),
            estimatedTokens: 1,
            messageBudget: 1,
            trimmed: input.messages.length > 1,
          };
        },
      },
      hooks: {
        onBeforeRun: before,
        onAfterAssemble: (ctx) => {
          afterAssemble(ctx.assemble.trimmed);
        },
        onAfterRun: afterRun,
        onBeforeSave: beforeSave,
      },
    });

    const store = createMemoryStore();
    const session = await createSession({
      agent,
      store,
      id: "ses_ext",
      extensions: [ext],
      initialMessages: [userMessage("old")],
    });

    await session.run("new");
    expect(before).toHaveBeenCalledOnce();
    expect(afterAssemble).toHaveBeenCalledWith(true);
    expect(afterRun).toHaveBeenCalledOnce();
    expect(beforeSave).toHaveBeenCalled();
    expect(session.lastAssemble?.view).toHaveLength(1);
    expect(session.messages.filter((m) => m.role === "user").length).toBe(2);

    await agent.dispose();
  });

  it("lets onAfterAssemble replace the view", async () => {
    const agent = await createAgent({
      provider: mockProvider([{ text: "ok" }]),
    });

    const session = await createSession({
      agent,
      hooks: {
        onAfterAssemble(ctx) {
          return {
            ...ctx.assemble,
            view: [userMessage("forced")],
            dropped: ctx.pending,
            trimmed: true,
          };
        },
      },
    });

    await session.run("ignored");
    expect(session.lastAssemble?.view).toEqual([userMessage("forced")]);
    await agent.dispose();
  });
});
