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
import { outlineDigest } from "./outline.js";
import { createRecallTool, recallContextExtension } from "./recall.js";
import { createSession } from "./session.js";
import { hiddenMarker, parseHiddenIds } from "./stash.js";
import { hmtContextExtension } from "./strategies.js";
import { createContextStash } from "./stash.js";

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
    expect(page.content).toContain("mode=page");
    expect(page.content).toContain("FULL-xxxxx");
    expect(page.content).toContain("next_offset=10");

    const missing = await tool.execute({ id: "nope" }, {});
    expect(missing.isError).toBe(true);
  });

  it("session folds middle and model can recall via tool", async () => {
    const blob = "SECRET_PAYLOAD_" + "B".repeat(8_000);
    const hmt = hmtContextExtension({
      budget: {
        maxContextTokens: 100_000,
        headTurns: 1,
        tailTurns: 1,
        fold: {
          maxToolResultChars: 600,
          toolResultHeadChars: 40,
          toolResultTailChars: 40,
        },
      },
    });
    const recall = recallContextExtension(hmt.stash);
    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [
            {
              id: "r1",
              name: "recall_context",
              arguments: {
                id: "tool_c1",
                need: { kind: "text", query: "SECRET_PAYLOAD_" },
              },
            },
          ],
        },
        { text: "recalled" },
      ]),
      tools: [recall.tool],
    });

    const session = await createSession({
      agent,
      stash: hmt.stash,
      extensions: [hmt],
      initialMessages: [
        userMessage("earlier constraint"),
        assistantMessage([textPart("ok")]),
        userMessage("run tool"),
        assistantMessage([toolCallPart("c1", "bash", { command: "x" })]),
        toolMessage([toolResultPart("c1", blob)]),
        userMessage("continue later"),
        assistantMessage([textPart("tail")]),
      ],
    });

    const result = await session.run("please recall the hidden bash output");
    expect(session.lastAssemble?.strategy).toBe("hmt");
    expect(session.lastAssemble?.foldedParts).toBeGreaterThan(0);
    const viewTool = session.lastAssemble?.view.find((m) => m.role === "tool");
    if (viewTool?.content[0]?.type === "tool_result") {
      expect(parseHiddenIds(viewTool.content[0].content)).toContain("tool_c1");
    }
    expect(result.text).toBe("recalled");
    const recallResult = result.messages.find(
      (m) =>
        m.role === "tool" &&
        m.content.some(
          (p) => p.type === "tool_result" && p.content.includes("SECRET_PAYLOAD_"),
        ),
    );
    expect(recallResult).toBeTruthy();
    const recalled = result.messages.find(
      (m) =>
        m.role === "tool" &&
        m.content.some(
          (p) => p.type === "tool_result" && p.content.includes("mode=select"),
        ),
    );
    const body = recalled?.content.find((p) => p.type === "tool_result");
    expect(body?.type).toBe("tool_result");
    if (body?.type === "tool_result") {
      expect(body.content.length).toBeLessThan(500);
      expect(body.content).toContain("SECRET_PAYLOAD_");
    }
    await agent.dispose();
  });

  it("indexes a key name in the marker and returns only that line", async () => {
    const value = "min-eval-skill-7f3c";
    const body = `${"H".repeat(5_000)}\nTOKEN_SKILL=${value}\n${"T".repeat(1_000)}`;
    const stash = createContextStash();
    const entry = stash.put({
      kind: "tool_result",
      content: body,
      id: "tool_c1",
      toolName: "read_file",
    });
    const marker = hiddenMarker(entry.id, outlineDigest(entry));
    expect(marker).toContain("key=TOKEN_SKILL@");
    expect(marker).not.toContain(value);
    expect(parseHiddenIds(marker)).toEqual(["tool_c1"]);

    const tool = createRecallTool(stash);
    const outline = await tool.execute({ id: "tool_c1" }, {});
    expect(outline.content).toContain("mode=outline");
    expect(outline.content).toContain("TOKEN_SKILL");
    expect(outline.content).not.toContain(value);

    const hit = await tool.execute(
      { id: "tool_c1", need: { kind: "key", query: "TOKEN_SKILL" } },
      {},
    );
    expect(hit.isError).toBeFalsy();
    expect(hit.content).toContain("mode=select");
    expect(hit.content).toContain(`TOKEN_SKILL=${value}`);
    expect(hit.content.length).toBeLessThan(800);
  });
});
