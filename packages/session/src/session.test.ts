import { createAgent, mockProvider, textPart } from "@min/core";
import { describe, expect, it } from "vitest";
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
      },
    });

    await session.run("A".repeat(800));
    await session.run("B".repeat(800));
    await session.run("C".repeat(800));

    expect(session.messages.filter((m) => m.role === "user").length).toBe(3);
    expect(session.lastAssemble?.trimmed).toBe(true);
    await agent.dispose();
  });
});
