import {
  assistantMessage,
  mockProvider,
  textPart,
  toolCallPart,
  toolMessage,
  toolResultPart,
  userMessage,
} from "@min/core";
import { describe, expect, it } from "vitest";
import { compactHistoryMessages } from "./assemble-compact.js";
import { assembleHybridContext } from "./assemble-hybrid.js";
import { assembleStickyTrimContext } from "./assemble-sticky-trim.js";
import { assembleToolOffloadContext } from "./assemble-tool-offload.js";
import { createContextStash, parseHiddenIds } from "./stash.js";
import { estimateMessagesTokens } from "./tokens.js";

function fatHistory(middle = 3, blob = 12_000) {
  const msgs = [
    userMessage("sticky constraint: use src/"),
    assistantMessage([textPart("ok")]),
  ];
  for (let i = 0; i < middle; i++) {
    const id = `c${i}`;
    msgs.push(userMessage(`mid ${i}`));
    msgs.push(
      assistantMessage([toolCallPart(id, "bash", { command: `echo ${i}` })]),
    );
    msgs.push(toolMessage([toolResultPart(id, "X".repeat(blob))]));
  }
  msgs.push(userMessage("tail now"));
  msgs.push(assistantMessage([textPart("working")]));
  return msgs;
}

describe("assembleToolOffloadContext", () => {
  it("folds unprotected tool results into stash and keeps tail", () => {
    const stash = createContextStash();
    const messages = fatHistory(2, 10_000);
    const result = assembleToolOffloadContext(
      {
        messages,
        budget: {
          maxContextTokens: 100_000,
          stash,
          fold: {
            maxToolResultChars: 800,
            toolResultHeadChars: 80,
            toolResultTailChars: 80,
          },
        },
      },
      { protectTailTurns: 1 },
    );

    expect(result.strategy).toBe("tool-offload");
    expect(result.foldedParts).toBeGreaterThan(0);
    expect(stash.size).toBeGreaterThan(0);
    expect(result.kept).toBe(messages);

    // Last tool in unprotected region should be folded; tail has no tool.
    const viewTools = result.view.filter((m) => m.role === "tool");
    expect(viewTools.length).toBeGreaterThan(0);
    const first = viewTools[0]!.content[0];
    expect(first?.type).toBe("tool_result");
    if (first?.type === "tool_result") {
      expect(parseHiddenIds(first.content).length).toBeGreaterThan(0);
      expect(first.content.length).toBeLessThan(10_000);
    }
  });
});

describe("assembleStickyTrimContext", () => {
  it("keeps the sticky prefix while dropping later turns under budget", () => {
    const messages = [];
    for (let i = 0; i < 8; i++) {
      messages.push(userMessage(`u${i}-${"x".repeat(300)}`));
      messages.push(assistantMessage([textPart(`a${i}-${"y".repeat(300)}`)]));
    }

    const result = assembleStickyTrimContext(
      {
        messages,
        budget: {
          maxContextTokens: 900,
          reservedOutputTokens: 100,
        },
      },
      { stickyTurns: 1 },
    );

    expect(result.strategy).toBe("sticky-trim");
    expect(result.trimmed).toBe(true);
    expect(result.regions?.headTurns).toBeGreaterThanOrEqual(1);
    // First user message should still be present (sticky).
    const firstUser = result.view.find((m) => m.role === "user");
    expect(
      firstUser?.content[0]?.type === "text" &&
        firstUser.content[0].text.startsWith("u0-"),
    ).toBe(true);
    expect(estimateMessagesTokens(result.view)).toBeLessThanOrEqual(
      result.messageBudget * 1.15,
    );
  });
});

describe("compactHistoryMessages", () => {
  it("rewrites store to summary + recent turns", async () => {
    const messages = [];
    for (let i = 0; i < 6; i++) {
      messages.push(userMessage(`turn-${i} detail ${"z".repeat(200)}`));
      messages.push(assistantMessage([textPart(`reply-${i} ${"w".repeat(200)}`)]));
    }

    const provider = mockProvider([
      {
        text: "Objective: test\nDecisions: none\nConstraints: none\nFacts: many turns\nOpen threads: none\nRejected: none",
      },
    ]);

    const result = await compactHistoryMessages(messages, {
      provider,
      keepRecentTurns: 2,
    });

    expect(provider.calls.length).toBe(1);
    expect(result.droppedMessageCount).toBeGreaterThan(0);
    expect(result.keptTurns).toBe(2);
    expect(result.messages[0]?.role).toBe("assistant");
    expect(
      result.messages[0]?.content[0]?.type === "text" &&
        result.messages[0].content[0].text.includes("[context compact]"),
    ).toBe(true);
  });

  it("no-ops when history fits keepRecentTurns", async () => {
    const provider = mockProvider([{ text: "should not run" }]);
    const messages = [userMessage("hi"), assistantMessage([textPart("yo")])];
    const result = await compactHistoryMessages(messages, {
      provider,
      keepRecentTurns: 2,
    });
    expect(provider.calls.length).toBe(0);
    expect(result.droppedMessageCount).toBe(0);
    expect(result.messages).toHaveLength(2);
  });
});

describe("assembleHybridContext", () => {
  it("folds middle tools while keeping sticky head and protecting tail", () => {
    const stash = createContextStash();
    const messages = fatHistory(3, 10_000);
    const result = assembleHybridContext(
      {
        messages,
        budget: {
          maxContextTokens: 100_000,
          stash,
          fold: {
            maxToolResultChars: 600,
            toolResultHeadChars: 80,
            toolResultTailChars: 80,
          },
        },
      },
      { stickyTurns: 1, protectTailTurns: 1 },
    );
    expect(result.strategy).toBe("hybrid");
    expect(result.foldedParts).toBeGreaterThan(0);
    expect(stash.size).toBeGreaterThan(0);
    expect(result.kept).toBe(messages);
    expect(result.view[0]).toEqual(messages[0]);
  });
  it("ages older tool_results inside a single user-turn tool loop", () => {
    const stash = createContextStash();
    const blob = "Q".repeat(6_000);
    const messages = [
      userMessage("implement feature"),
      assistantMessage([toolCallPart("t1", "read_file", { path: "a" })]),
      toolMessage([toolResultPart("t1", blob)]),
      assistantMessage([toolCallPart("t2", "read_file", { path: "b" })]),
      toolMessage([toolResultPart("t2", blob)]),
      assistantMessage([toolCallPart("t3", "read_file", { path: "c" })]),
      toolMessage([toolResultPart("t3", blob)]),
    ];
    const result = assembleHybridContext(
      {
        messages,
        budget: {
          maxContextTokens: 100_000,
          stash,
          fold: {
            maxToolResultChars: 400,
            toolResultHeadChars: 50,
            toolResultTailChars: 50,
          },
        },
      },
      { stickyTurns: 1, protectTailTurns: 1, protectRecentToolResults: 1 },
    );
    expect(result.regions?.middleTurns).toBe(0);
    expect(result.foldedParts).toBeGreaterThan(0);
    expect(stash.size).toBeGreaterThan(0);
    expect(result.kept).toBe(messages);

    const viewTools = result.view.filter((m) => m.role === "tool");
    expect(viewTools.length).toBe(3);
    const lengths = viewTools.map((m) => {
      const p = m.content[0];
      return p?.type === "tool_result" ? p.content.length : 0;
    });
    // Older bodies folded; most recent protected.
    expect(lengths[0]!).toBeLessThan(blob.length);
    expect(lengths[1]!).toBeLessThan(blob.length);
    expect(lengths[2]!).toBe(blob.length);
  });
});
