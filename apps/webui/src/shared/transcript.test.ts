import { describe, expect, it } from "vitest";
import { activityLabel, linesFromMessages, summarizeToolCall } from "./transcript.js";

describe("transcript", () => {
  it("rebuilds user, assistant, and tool lines from session messages", () => {
    expect(
      linesFromMessages([
        { role: "system", content: [{ type: "text", text: "hidden" }] },
        { role: "user", content: [{ type: "text", text: "hello" }] },
        {
          role: "user",
          content: [
            { type: "image", filename: "shot.png", blobId: "a".repeat(64) },
            { type: "document", filename: "spec.pdf", blobId: "b".repeat(64) },
          ],
        },
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
      { kind: "user", text: "image shot.png" },
      { kind: "user", text: "document spec.pdf" },
      { kind: "assistant", text: "ok" },
      { kind: "tool", text: "bash  ls" },
      { kind: "tool-result", text: "a\nb" },
    ]);
    const rendered = linesFromMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "image", filename: "shot.png", blobId: "a".repeat(64) },
        ],
      },
    ])
      .map((line) => line.text)
      .join("\n");
    expect(rendered).not.toContain("a".repeat(64));
    expect(rendered).not.toMatch(/base64/i);
    expect(summarizeToolCall("read_file", { file_path: "README.md" })).toBe("read_file  README.md");
  });

  it("names the activity the same way as the terminal", () => {
    const t0 = 1_000_000;
    expect(
      activityLabel({
        status: "running",
        streaming: true,
        toolName: "bash",
        continuing: false,
        nowMs: t0 + 5000,
        runStartedAtMs: t0,
      }),
    ).toBe("Working... (5s)");
    expect(
      activityLabel({
        status: "idle",
        streaming: false,
        toolName: null,
        continuing: false,
        workedDurationMs: 2000,
        workedVisible: true,
      }),
    ).toBe("Worked for 2s");
    expect(
      activityLabel({ status: "idle", streaming: false, toolName: null, continuing: false }),
    ).toBeNull();
  });
});
