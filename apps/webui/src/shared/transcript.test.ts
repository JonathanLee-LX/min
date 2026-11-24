import { describe, expect, it } from "vitest";
import { activityLabel, finishToolLine, linesFromMessages, summarizeToolCall } from "./transcript.js";

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
    expect(linesFromMessages([
      {
        role: "assistant",
        content: [{ type: "tool_call", name: "bash", arguments: { command: "ls" } }],
      },
      {
        role: "tool",
        content: [{ type: "tool_result", content: "a\nb", isError: false }],
      },
    ])[0]).not.toHaveProperty("durationMs");
  });

  it("stamps each call's recorded duration and does not invent one", () => {
    const lines = linesFromMessages([
      {
        role: "assistant",
        content: [
          { type: "tool_call", id: "fast", name: "bash", arguments: { command: "true" } },
          { type: "tool_call", id: "slow", name: "bash", arguments: { command: "sleep 1" } },
          { type: "tool_call", id: "old", name: "read_file", arguments: { path: "a.ts" } },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool_result", toolCallId: "slow", content: "S", durationMs: 80 },
          { type: "tool_result", toolCallId: "fast", content: "F", durationMs: 12 },
          { type: "tool_result", toolCallId: "old", content: "legacy" },
        ],
      },
    ]);
    const tools = lines.filter((line) => line.kind === "tool");
    expect(tools.map((line) => [line.text, line.durationMs])).toEqual([
      ["bash  true", 12],
      ["bash  sleep 1", 80],
      ["read_file  a.ts", undefined],
    ]);
    expect(tools[2]).not.toHaveProperty("durationMs");
  });

  it("stores a final duration on the open row and leaves an earlier row", () => {
    const next = finishToolLine(
      [
        { kind: "tool", toolCallId: "sleep", text: "bash  sleep 4", durationMs: 4147 },
        { kind: "tool", toolCallId: "sleep", text: "bash  sleep 12", liveStartedAt: 50 },
        { kind: "tool", toolCallId: "other", text: "glob", liveStartedAt: 10 },
      ],
      "sleep",
      12_000,
    );
    expect(next[0]).toMatchObject({ durationMs: 4147 });
    expect(next[0]).not.toHaveProperty("liveStartedAt");
    expect(next[1]).toMatchObject({ durationMs: 12_000 });
    expect(next[1]).not.toHaveProperty("liveStartedAt");
    expect(next[2]).toMatchObject({ liveStartedAt: 10 });
    expect(next[2]).not.toHaveProperty("durationMs");
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
