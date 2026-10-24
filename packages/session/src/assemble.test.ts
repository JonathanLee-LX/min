import {
  assistantMessage,
  textPart,
  toolCallPart,
  toolMessage,
  toolResultPart,
  userMessage,
} from "@min/core";
import { describe, expect, it } from "vitest";
import { assembleContext, splitUserTurns } from "./assemble.js";
import { estimateMessagesTokens } from "./tokens.js";

describe("splitUserTurns", () => {
  it("groups assistant/tool under the preceding user", () => {
    const u1 = userMessage("a");
    const a1 = assistantMessage([textPart("A")]);
    const u2 = userMessage("b");
    const turns = splitUserTurns([u1, a1, u2]);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual([u1, a1]);
    expect(turns[1]).toEqual([u2]);
  });
});

describe("assembleContext", () => {
  it("drops oldest turns when over budget and keeps a suffix", () => {
    const messages = [];
    for (let i = 0; i < 10; i++) {
      messages.push(userMessage(`user-${i}-${"x".repeat(200)}`));
      messages.push(assistantMessage([textPart(`asst-${i}-${"y".repeat(200)}`)]));
    }

    const fullTokens = estimateMessagesTokens(messages);
    const result = assembleContext({
      messages,
      budget: {
        maxContextTokens: Math.floor(fullTokens / 3) + 200,
        reservedOutputTokens: 50,
        fold: false,
      },
    });

    expect(result.trimmed).toBe(true);
    expect(result.dropped.length).toBeGreaterThan(0);
    expect(result.view.length).toBeGreaterThan(0);
    expect(result.kept).toEqual(result.view);
    expect(result.view[0]?.role).toBe("user");
    expect(messages.slice(-result.kept!.length)).toEqual(result.kept);
    expect([...result.dropped, ...result.kept!]).toEqual(messages);
  });

  it("respects maxUserTurns", () => {
    const messages = [
      userMessage("1"),
      assistantMessage([textPart("a")]),
      userMessage("2"),
      assistantMessage([textPart("b")]),
      userMessage("3"),
    ];
    const result = assembleContext({
      messages,
      budget: {
        maxContextTokens: 100_000,
        maxUserTurns: 2,
        fold: false,
      },
    });
    expect(result.kept).toEqual(messages.slice(2));
    expect(result.trimmed).toBe(true);
  });

  it("folds long tool results in view but kept stays full", () => {
    const big = "Q".repeat(20_000);
    const toolMsg = toolMessage([toolResultPart("c1", big)]);
    const messages = [
      userMessage("run"),
      assistantMessage([toolCallPart("c1", "bash", { command: "x" })]),
      toolMsg,
    ];

    const result = assembleContext({
      messages,
      budget: {
        maxContextTokens: 100_000,
        fold: {
          maxToolResultChars: 1000,
          toolResultHeadChars: 100,
          toolResultTailChars: 100,
        },
      },
    });

    expect(result.foldedParts).toBeGreaterThan(0);
    expect(result.trimmed).toBe(true);
    expect(result.kept).toEqual(messages);
    // Same object refs as input suffix — folding must not rewrite canonical.
    expect(result.kept![2]).toBe(toolMsg);
    const keptTool = result.kept!.find((m) => m.role === "tool");
    expect(
      keptTool?.content[0]?.type === "tool_result" &&
        keptTool.content[0].content.length,
    ).toBe(20_000);

    const viewTool = result.view.find((m) => m.role === "tool");
    expect(
      viewTool?.content[0]?.type === "tool_result" &&
        viewTool.content[0].content.length,
    ).toBeLessThan(20_000);
  });

  it("shrinks a single oversize turn to fit messageBudget", () => {
    const toolMsg = toolMessage([toolResultPart("c1", "W".repeat(80_000))]);
    const messages = [
      userMessage("huge"),
      assistantMessage([toolCallPart("c1", "read_file", { path: "x" })]),
      toolMsg,
    ];

    const result = assembleContext({
      messages,
      budget: {
        maxContextTokens: 2_000,
        reservedOutputTokens: 200,
        fold: { maxToolResultChars: 50_000 },
      },
    });

    expect(result.view.length).toBe(messages.length);
    expect(result.estimatedTokens).toBeLessThanOrEqual(
      result.messageBudget + 200 /* system/tools overhead already excluded */,
    );
    // message tokens alone should be near/under budget
    expect(estimateMessagesTokens(result.view)).toBeLessThanOrEqual(
      result.messageBudget * 1.1,
    );
    expect(result.foldedParts).toBeGreaterThan(0);
    // canonical kept still full
    const keptPart = result.kept?.at(-1)?.content[0];
    expect(keptPart?.type).toBe("tool_result");
    if (keptPart?.type === "tool_result") {
      expect(keptPart.content.length).toBe(80_000);
    }
  });

  it("accepts an injected token estimator", () => {
    let calls = 0;
    const result = assembleContext({
      messages: [userMessage("hi")],
      budget: {
        maxContextTokens: 10_000,
        fold: false,
        estimate: {
          text: (t) => t.length,
          message: () => {
            calls += 1;
            return 1;
          },
          messages: (ms) => {
            calls += 1;
            return ms.length;
          },
          tools: () => 0,
          system: () => 0,
        },
      },
    });
    expect(calls).toBeGreaterThan(0);
    expect(result.view).toHaveLength(1);
  });
});
