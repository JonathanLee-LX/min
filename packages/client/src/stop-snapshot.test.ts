import { assistantMessage, textPart, toolCallPart, toolMessage, toolResultPart, userMessage } from "@min-agent/core";
import { describe, expect, it } from "vitest";
import { assembleStopMessages } from "./stop-snapshot.js";

describe("assembleStopMessages", () => {
  it("keeps committed history, the partial assistant text, finished tools, and the queue", () => {
    const committed = [userMessage("earlier"), assistantMessage([textPart("done")])];
    const transcript = [
      ...committed,
      userMessage("now"),
      assistantMessage([toolCallPart("c1", "bash", { command: "ls" })]),
    ];
    const messages = assembleStopMessages({
      committed,
      transcript,
      partialText: "working",
      toolResults: [toolResultPart("c1", "file.txt")],
      queued: ["next"],
      userText: "now",
    });

    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
    expect(messages.at(-2)).toEqual(assistantMessage([textPart("working")]));
    expect(messages.at(-1)).toEqual(userMessage("next"));
    expect(JSON.stringify(messages)).not.toContain("secret-thought");
    const tool = messages.find((message) => message.role === "tool");
    expect(tool).toEqual(toolMessage([toolResultPart("c1", "file.txt")]));
  });

  it("does not duplicate a partial that the runner already pushed", () => {
    const transcript = [userMessage("now"), assistantMessage([textPart("working")])];
    const messages = assembleStopMessages({
      committed: [],
      transcript,
      partialText: "working",
      toolResults: [],
      queued: [],
    });
    expect(messages).toHaveLength(2);
  });
});
