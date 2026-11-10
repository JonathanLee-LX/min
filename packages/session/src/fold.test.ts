import {
  assistantMessage,
  imagePart,
  textPart,
  toolCallPart,
  toolMessage,
  toolResultPart,
  userMessage,
} from "@min-agent/core";
import { PNG_SIG } from "./media.fixtures.js";
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

  it("clones image and document parts by field instead of collapsing to text", () => {
    const blobId = "a".repeat(64);
    const messages = [
      {
        role: "user" as const,
        content: [
          imagePart({
            mediaType: "image/png",
            blobId,
            filename: "shot.png",
            data: PNG_SIG,
          }),
        ],
      },
    ];
    const { messages: view, foldedParts } = foldMessagesForView(messages, {});
    expect(foldedParts).toBe(0);
    const part = view[0]!.content[0];
    expect(part).toEqual({
      type: "image",
      mediaType: "image/png",
      blobId,
      filename: "shot.png",
    });
    expect(part).not.toHaveProperty("data");
  });

  it("does not fold image bytes into tool-result markers", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          imagePart({
            mediaType: "image/png",
            blobId: "a".repeat(64),
            filename: "shot.png",
          }),
        ],
      },
    ];
    const { messages: view } = foldMessagesForView(messages, {
      fold: {
        maxToolResultChars: 10,
        toolResultHeadChars: 4,
        toolResultTailChars: 4,
      },
    });
    const part = view[0]!.content[0];
    expect(part?.type).toBe("image");
    if (part?.type === "image") {
      expect(JSON.stringify(part)).not.toMatch(/truncated|hidden:/);
    }
  });

  it("throws on unknown content parts instead of collapsing them to text", () => {
    expect(() =>
      foldMessagesForView(
        [{ role: "user", content: [{ type: "audio" } as never] }],
        {},
      ),
    ).toThrow(/unknown content part: audio/);
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

  it("does not fold recall pages even when the tool name map is missing", () => {
    const page = "id=tool_c1 kind=tool_result tool=read_file chars=10000 offset=0 returned=12000 complete\n\n" + "R".repeat(12_000);
    const messages = [toolMessage([toolResultPart("r1", page)])];
    const { foldedParts, messages: view } = foldMessagesForView(messages, {
      fold: { maxToolResultChars: 500, toolResultHeadChars: 50, toolResultTailChars: 50 },
      protectToolNames: ["recall_context"],
    });
    expect(foldedParts).toBe(0);
    const part = view[0]!.content[0];
    expect(part?.type).toBe("tool_result");
    if (part?.type === "tool_result") expect(part.content).toBe(page);
  });

  it("does not fold protected tool names such as recall_context", () => {
    const page = "R".repeat(12_000);
    const messages = [
      userMessage("go"),
      assistantMessage([toolCallPart("c1", "bash", { command: "x" })]),
      toolMessage([toolResultPart("c1", "B".repeat(10_000))]),
      assistantMessage([toolCallPart("r1", "recall_context", { id: "tool_c1" })]),
      toolMessage([toolResultPart("r1", page)]),
    ];
    const { messages: view, foldedParts } = foldMessagesForView(messages, {
      fold: {
        maxToolResultChars: 500,
        toolResultHeadChars: 50,
        toolResultTailChars: 50,
      },
      toolNameByCallId: new Map([
        ["c1", "bash"],
        ["r1", "recall_context"],
      ]),
      protectToolNames: ["recall_context"],
    });
    expect(foldedParts).toBe(1);
    const bash = view[2]!.content[0];
    const recalled = view[4]!.content[0];
    expect(bash?.type).toBe("tool_result");
    expect(recalled?.type).toBe("tool_result");
    if (bash?.type === "tool_result") {
      expect(bash.content.length).toBeLessThan(10_000);
    }
    if (recalled?.type === "tool_result") {
      expect(recalled.content).toBe(page);
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
