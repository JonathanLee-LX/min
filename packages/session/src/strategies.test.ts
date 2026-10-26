import {
  assistantMessage,
  createAgent,
  mockProvider,
  textPart,
  toolCallPart,
  toolMessage,
  toolResultPart,
  userMessage,
} from "@min-agent/core";
import { describe, expect, it } from "vitest";
import { createSession } from "./session.js";
import { hmtContextExtension, trimContextExtension } from "./strategies.js";

describe("pluggable context strategies", () => {
  it("trim extension keeps strategy id", async () => {
    const agent = await createAgent({
      provider: mockProvider([{ text: "ok" }]),
    });
    const session = await createSession({
      agent,
      extensions: [trimContextExtension({ budget: { maxContextTokens: 32_000 } })],
    });
    await session.run("hi");
    expect(session.lastAssemble?.strategy).toBe("trim");
    await agent.dispose();
  });

  it("hmt extension replaces the default trim assembler", async () => {
    const blob = "Z".repeat(10_000);
    const hmt = hmtContextExtension({
      budget: {
        maxContextTokens: 100_000,
        headTurns: 1,
        tailTurns: 1,
        fold: {
          maxToolResultChars: 500,
          toolResultHeadChars: 50,
          toolResultTailChars: 50,
        },
      },
    });
    const agent = await createAgent({
      provider: mockProvider([{ text: "ok" }]),
    });
    const session = await createSession({
      agent,
      stash: hmt.stash,
      extensions: [hmt],
      initialMessages: [
        userMessage("head"),
        assistantMessage([textPart("ack")]),
        userMessage("mid"),
        assistantMessage([toolCallPart("c1", "bash", { command: "x" })]),
        toolMessage([toolResultPart("c1", blob)]),
        userMessage("tail"),
        assistantMessage([textPart("done")]),
      ],
    });
    await session.run("go");
    expect(session.lastAssemble?.strategy).toBe("hmt");
    expect(session.lastAssemble?.foldedParts).toBeGreaterThan(0);
    expect(hmt.stash.size).toBeGreaterThan(0);
    await agent.dispose();
  });
});
