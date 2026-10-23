import { userMessage, assistantMessage, textPart } from "@min/core";
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
      },
    });

    expect(result.trimmed).toBe(true);
    expect(result.dropped.length).toBeGreaterThan(0);
    expect(result.view.length).toBeGreaterThan(0);
    expect(result.view[0]?.role).toBe("user");
    // view is suffix of original
    expect(messages.slice(-result.view.length)).toEqual(result.view);
    expect([...result.dropped, ...result.view]).toEqual(messages);
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
      budget: { maxContextTokens: 100_000, maxUserTurns: 2 },
    });
    expect(result.view).toEqual(messages.slice(2));
    expect(result.trimmed).toBe(true);
  });
});
