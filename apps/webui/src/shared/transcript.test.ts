import { describe, expect, it } from "vitest";
import { activityLabel, linesFromMessages, summarizeToolCall } from "./transcript.js";

describe("transcript", () => {
  it("rebuilds user, assistant, and tool lines from session messages", () => {
    expect(
      linesFromMessages([
        { role: "system", content: [{ type: "text", text: "hidden" }] },
        { role: "user", content: [{ type: "text", text: "hello" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "ok" },
            { type: "tool_call", name: "bash", arguments: { command: "ls" } },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool_result", content: "a\nb", isError: false }],
        },
      ]),
    ).toEqual([
      { kind: "user", text: "hello" },
      { kind: "assistant", text: "ok" },
      { kind: "tool", text: "bash  ls" },
      { kind: "tool-result", text: "a\nb" },
    ]);
    expect(summarizeToolCall("read_file", { file_path: "README.md" })).toBe("read_file  README.md");
  });

  it("names the activity the same way as the terminal", () => {
    expect(
      activityLabel({ status: "running", streaming: false, toolName: null, continuing: false }),
    ).toBe("Thinking...");
    expect(
      activityLabel({ status: "running", streaming: false, toolName: "bash", continuing: false }),
    ).toBe("Tool calling...");
    expect(
      activityLabel({ status: "running", streaming: true, toolName: null, continuing: false }),
    ).toBe("Working...");
    expect(
      activityLabel({ status: "idle", streaming: false, toolName: null, continuing: false }),
    ).toBeNull();
  });
});
