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
import { createContextStash, parseHiddenIds } from "./stash.js";
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

describe("assembleContext H-M-T", () => {
  it("keeps head and tail verbatim while folding middle tool results", () => {
    const big = "Q".repeat(20_000);
    const stash = createContextStash();
    const messages = [
      userMessage("head-constraint"),
      assistantMessage([textPart("ack head")]),
      userMessage("middle-run"),
      assistantMessage([toolCallPart("c1", "bash", { command: "x" })]),
      toolMessage([toolResultPart("c1", big)]),
      userMessage("tail-now"),
      assistantMessage([textPart("working")]),
    ];

    const result = assembleContext({
      messages,
      budget: {
        maxContextTokens: 100_000,
        headTurns: 1,
        tailTurns: 1,
        fold: {
          maxToolResultChars: 1000,
          toolResultHeadChars: 100,
          toolResultTailChars: 100,
        },
        stash,
      },
    });

    expect(result.regions).toEqual({
      headTurns: 1,
      middleTurns: 1,
      tailTurns: 1,
    });
    expect(result.foldedParts).toBeGreaterThan(0);
    expect(result.kept).toBe(messages);
    expect(result.dropped).toEqual([]);

    // Head user text untouched in view
    expect(result.view[0]).toEqual(messages[0]);
    // Tail last assistant untouched
    expect(result.view.at(-1)).toEqual(messages.at(-1));

    const viewTool = result.view.find((m) => m.role === "tool");
    expect(viewTool?.content[0]?.type).toBe("tool_result");
    if (viewTool?.content[0]?.type === "tool_result") {
      expect(viewTool.content[0].content.length).toBeLessThan(big.length);
      const ids = parseHiddenIds(viewTool.content[0].content);
      expect(ids).toEqual(["tool_c1"]);
      expect(stash.get("tool_c1")?.content).toBe(big);
    }
  });

  it("does not fold tool results that sit in the tail", () => {
    const big = "T".repeat(12_000);
    const messages = [
      userMessage("only"),
      assistantMessage([toolCallPart("c1", "read_file", { path: "x" })]),
      toolMessage([toolResultPart("c1", big)]),
    ];

    const result = assembleContext({
      messages,
      budget: {
        maxContextTokens: 100_000,
        headTurns: 0,
        tailTurns: 2,
        fold: { maxToolResultChars: 500 },
        stash: createContextStash(),
      },
    });

    // Single turn is entirely tail → no middle fold
    expect(result.regions?.middleTurns).toBe(0);
    const viewTool = result.view.find((m) => m.role === "tool");
    if (viewTool?.content[0]?.type === "tool_result") {
      expect(viewTool.content[0].content.length).toBe(big.length);
    }
  });

  it("respects maxUserTurns by shrinking middle first", () => {
    const messages = [
      userMessage("1"),
      assistantMessage([textPart("a")]),
      userMessage("2"),
      assistantMessage([textPart("b")]),
      userMessage("3"),
      assistantMessage([textPart("c")]),
      userMessage("4"),
      assistantMessage([textPart("d")]),
      userMessage("5"),
    ];
    const result = assembleContext({
      messages,
      budget: {
        maxContextTokens: 100_000,
        headTurns: 1,
        tailTurns: 1,
        maxUserTurns: 3,
        fold: false,
      },
    });
    // head(1)+middle(1)+tail(1) = 3
    expect(result.regions).toEqual({
      headTurns: 1,
      middleTurns: 1,
      tailTurns: 1,
    });
    expect(result.view.some((m) => m.role === "user" && m.content[0]?.type === "text" && m.content[0].text === "1")).toBe(true);
    expect(result.view.some((m) => m.role === "user" && m.content[0]?.type === "text" && m.content[0].text === "5")).toBe(true);
    expect(result.kept).toEqual(messages);
  });

  it("collapses middle under tight token budget and keeps head prefix stable", () => {
    const stash = createContextStash();
    const messages = [];
    for (let i = 0; i < 8; i++) {
      messages.push(userMessage(`user-${i}-${"x".repeat(400)}`));
      messages.push(
        assistantMessage([
          toolCallPart(`c${i}`, "bash", { command: `echo ${i}` }),
        ]),
      );
      messages.push(toolMessage([toolResultPart(`c${i}`, "Z".repeat(2000))]));
    }

    const result = assembleContext({
      messages,
      budget: {
        maxContextTokens: 3_000,
        reservedOutputTokens: 200,
        headTurns: 1,
        tailTurns: 1,
        fold: { maxToolResultChars: 400, toolResultHeadChars: 80, toolResultTailChars: 80 },
        stash,
      },
    });

    expect(result.trimmed).toBe(true);
    expect(result.view[0]).toEqual(messages[0]);
    expect(result.kept).toEqual(messages);
    expect(stash.size).toBeGreaterThan(0);
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
    expect(estimateMessagesTokens(result.view)).toBeGreaterThan(0);
  });
});
