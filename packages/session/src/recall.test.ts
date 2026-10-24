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
import { describe, expect, it } from "vitest";
import { createRecallTool, recallContextExtension } from "./recall.js";
import { createSession } from "./session.js";
import { createContextStash, parseHiddenIds } from "./stash.js";

describe("recall_context", () => {
  it("lists and returns stashed payloads", async () => {
    const stash = createContextStash();
    stash.put({
      kind: "tool_result",
      id: "tool_c1",
      toolCallId: "c1",
      toolName: "bash",
      content: "FULL-" + "x".repeat(100),
    });
    const tool = createRecallTool(stash, { defaultLimit: 20 });

    const listed = await tool.execute({}, {});
    expect(listed.content).toContain("tool_c1");
    expect(listed.content).toContain("bash");

    const page = await tool.execute({ id: "tool_c1", offset: 0, limit: 10 }, {});
    expect(page.isError).toBeFalsy();
    expect(page.content).toContain("FULL-xxxxx");
    expect(page.content).toContain("next_offset=10");

    const missing = await tool.execute({ id: "nope" }, {});
    expect(missing.isError).toBe(true);
  });

  it("session folds middle and model can recall via tool", async () => {
    const blob = "SECRET_PAYLOAD_" + "B".repeat(8_000);
    const stash = createContextStash();
    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [{ id: "r1", name: "recall_context", arguments: { id: "tool_c1" } }],
        },
        { text: "recalled" },
      ]),
      extensions: [recallContextExtension(stash)],
    });

    const session = await createSession({
      agent,
      stash,
      initialMessages: [
        userMessage("earlier constraint"),
        assistantMessage([textPart("ok")]),
        userMessage("run tool"),
        assistantMessage([toolCallPart("c1", "bash", { command: "x" })]),
        toolMessage([toolResultPart("c1", blob)]),
        userMessage("continue later"),
        assistantMessage([textPart("tail")]),
      ],
      budget: {
        maxContextTokens: 100_000,
        headTurns: 1,
        tailTurns: 1,
        fold: {
          maxToolResultChars: 600,
          toolResultHeadChars: 40,
          toolResultTailChars: 40,
        },
        stash,
      },
    });

    const result = await session.run("please recall the hidden bash output");
    expect(session.lastAssemble?.foldedParts).toBeGreaterThan(0);
    const viewTool = session.lastAssemble?.view.find((m) => m.role === "tool");
    if (viewTool?.content[0]?.type === "tool_result") {
      expect(parseHiddenIds(viewTool.content[0].content)).toContain("tool_c1");
    }
    expect(result.text).toBe("recalled");
    // Tool result from recall should contain the secret
    const recallResult = result.messages.find(
      (m) =>
        m.role === "tool" &&
        m.content.some(
          (p) => p.type === "tool_result" && p.content.includes("SECRET_PAYLOAD_"),
        ),
    );
    expect(recallResult).toBeTruthy();
    await agent.dispose();
  });
});
