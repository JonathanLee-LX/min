import {
  assistantMessage,
  textPart,
  toolCallPart,
  toolMessage,
  toolResultPart,
  userMessage,
} from "@min-agent/core";
import { describe, expect, it } from "vitest";
import {
  foldMessagesForView,
  foldText,
  shrinkToolResultsToFit,
} from "./fold.js";
import { createContextStash, parseHiddenIds } from "./stash.js";
import { estimateMessagesTokens } from "./tokens.js";

describe("foldText", () => {
  it("keeps short text unchanged", () => {
    expect(foldText("hello", 100, 10, 10, "…")).toEqual({
      text: "hello",
      folded: false,
    });
  });

  it("keeps head and tail with marker", () => {
    const text = "A".repeat(50) + "MID" + "B".repeat(50);
    const { text: out, folded } = foldText(text, 40, 10, 10, "|");
    expect(folded).toBe(true);
    expect(out.startsWith("AAAAAAAAAA")).toBe(true);
    expect(out.endsWith("BBBBBBBBBB")).toBe(true);
    expect(out).toContain("|");
    expect(out.length).toBeLessThan(text.length);
  });
});

describe("foldMessagesForView", () => {
  it("does not mutate originals and folds long tool results", () => {
    const big = "x".repeat(20_000);
    const original = toolResultPart("c1", big);
    const messages = [
      userMessage("go"),
      assistantMessage([toolCallPart("c1", "bash", { command: "x" })]),
      toolMessage([original]),
    ];

    const { messages: view, foldedParts } = foldMessagesForView(messages, {
      fold: {
        maxToolResultChars: 1000,
        toolResultHeadChars: 100,
        toolResultTailChars: 100,
      },
    });

    expect(foldedParts).toBe(1);
    expect(original.content.length).toBe(20_000);
    const folded = view[2]!.content[0];
    expect(folded?.type).toBe("tool_result");
    if (folded?.type === "tool_result") {
      expect(folded.content.length).toBeLessThan(20_000);
      expect(folded.content).toContain("truncated");
    }
  });

  it("registers stash ids in the omission marker", () => {
    const stash = createContextStash();
    const big = "z".repeat(10_000);
    const messages = [
      userMessage("go"),
      assistantMessage([toolCallPart("c9", "bash", { command: "x" })]),
      toolMessage([toolResultPart("c9", big)]),
    ];
    const { messages: view, stashedIds } = foldMessagesForView(messages, {
      fold: {
        maxToolResultChars: 500,
        toolResultHeadChars: 50,
        toolResultTailChars: 50,
      },
      stash,
      toolNameByCallId: new Map([["c9", "bash"]]),
    });
    expect(stashedIds).toEqual(["tool_c9"]);
    const part = view[2]!.content[0];
    expect(part?.type).toBe("tool_result");
    if (part?.type === "tool_result") {
      expect(parseHiddenIds(part.content)).toEqual(["tool_c9"]);
      expect(stash.get("tool_c9")?.toolName).toBe("bash");
    }
  });

  it("disables when fold is false", () => {
    const big = "y".repeat(10_000);
    const messages = [toolMessage([toolResultPart("c1", big)])];
    const { messages: view, foldedParts } = foldMessagesForView(
      messages,
      false,
    );
    expect(foldedParts).toBe(0);
    expect(
      view[0]!.content[0]?.type === "tool_result" &&
        view[0]!.content[0].content.length,
    ).toBe(10_000);
  });
});

describe("shrinkToolResultsToFit", () => {
  it("shrinks until under token budget", () => {
    const messages = [
      toolMessage([toolResultPart("c1", "Z".repeat(40_000))]),
    ];
    const budget = 500;
    shrinkToolResultsToFit(
      messages,
      budget,
      estimateMessagesTokens,
      { maxToolResultChars: 8000 },
    );
    expect(estimateMessagesTokens(messages)).toBeLessThanOrEqual(budget * 1.05);
    const part = messages[0]!.content[0];
    expect(part?.type).toBe("tool_result");
    if (part?.type === "tool_result") {
      expect(part.content.length).toBeLessThan(40_000);
    }
  });
});
