import { describe, expect, it } from "vitest";
import {
  activityFor,
  BLOCK_GAP,
  gapBefore,
  shineText,
  SIDE_BLOCK_GAP,
  createPaintCache,
  paintTranscript,
} from "./paint.js";
import { layoutViewport, summarizeToolCall } from "./transcript.js";
import { displayWidth } from "./text.js";

describe("summarizeToolCall", () => {
  it("keeps the argument a person scans for", () => {
    expect(summarizeToolCall("bash", { command: "ls -la" })).toBe("bash  ls -la");
    expect(summarizeToolCall("read_file", { path: "src/a.ts" })).toBe("read_file  src/a.ts");
    expect(summarizeToolCall("noop", {})).toBe("noop");
  });
});

describe("paintTranscript", () => {
  it("paints chat turns as color bars without you/min labels", () => {
    const rows = paintTranscript(
      [
        { key: "u", kind: "user", text: "hello" },
        { key: "a", kind: "assistant", text: "a".repeat(40) },
      ],
      20,
    );
    expect(rows[0]).toMatchObject({ kind: "user", lead: true, gutter: "▌ " });
    expect(rows[0]?.body.trimEnd()).toBe("hello");
    expect(rows[0]?.gutter).not.toContain("you");
    const assistant = rows.filter((row) => row.kind === "assistant");
    expect(assistant.length).toBe(3);
    expect(assistant[0]?.lead).toBe(true);
    expect(assistant[0]?.gutter).toBe("▌ ");
    expect(assistant[0]?.gutter).not.toContain("min");
    expect(assistant[1]?.gutter).toBe("▌ ");
    expect(displayWidth(assistant[1]!.body.trimEnd())).toBe(18);
    const layout = layoutViewport(rows, 20, 50, 0);
    expect(layout.total).toBe(rows.length);
  });

  it("paints thinking without a think chrome prefix", () => {
    const rows = paintTranscript(
      [{ key: "th", kind: "thinking", text: "consider the options carefully" }],
      40,
    );
    expect(rows[0]?.kind).toBe("thinking");
    expect(rows[0]?.gutter).toBe("  ");
    expect(rows[0]?.gutter).not.toMatch(/think/i);
    expect(rows[0]?.body.trimEnd()).toBe("consider the options carefully");
    expect(rows.map((row) => row.text).join("")).not.toMatch(/think/i);
  });

  it("collapses multi-line thinking by default and expands with thinkingExpanded", () => {
    const text = "first understand requirements\nthen check files\nfinally write the solution";
    const collapsed = paintTranscript(
      [{ key: "th", kind: "thinking", text }],
      80,
    );
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.body).toContain("thinking: first understand requirements");
    expect(collapsed[0]?.body).toContain("3 lines");
    expect(collapsed[0]?.body).toContain("Ctrl+T");

    const expanded = paintTranscript(
      [{ key: "th", kind: "thinking", text }],
      80,
      undefined,
      { thinkingExpanded: true },
    );
    expect(expanded).toHaveLength(3);
    expect(expanded.map((r) => r.body.trimEnd())).toEqual([
      "first understand requirements",
      "then check files",
      "finally write the solution",
    ]);
  });

  it("nests tool output under the call and collapses it by default", () => {
    const rows = paintTranscript(
      [
        { key: "t", kind: "tool", text: "bash  ls" },
        { key: "r", kind: "tool-result", text: "apps\npackages\nREADME.md" },
      ],
      80,
    );
    expect(rows[0]).toMatchObject({ kind: "tool", gutter: "▸ ", body: expect.stringContaining("bash  ls") });
    const output = rows.filter((row) => row.kind === "tool-result");
    expect(output).toHaveLength(1);
    expect(output[0]?.body.trimEnd()).toContain("apps");
    expect(output[0]?.body.trimEnd()).toContain("3 lines");
    expect(output[0]?.body.trimEnd()).toContain("Ctrl+O");
    expect(output[0]?.gutter).toBe("  │ ");
  });

  it("expands tool output when toolOutputExpanded is set", () => {
    const rows = paintTranscript(
      [
        { key: "t", kind: "tool", text: "bash  ls" },
        { key: "r", kind: "tool-result", text: "apps\npackages\nREADME.md" },
      ],
      40,
      undefined,
      { toolOutputExpanded: true },
    );
    const output = rows.filter((row) => row.kind === "tool-result");
    expect(output.map((row) => row.body.trimEnd())).toEqual(["apps", "packages", "README.md"]);
    expect(output.every((row) => row.gutter === "  │ ")).toBe(true);
  });

  it("keeps a long answer by wrapping instead of dropping the tail", () => {
    const text = "a".repeat(100);
    const rows = paintTranscript([{ key: "a", kind: "assistant", text }], 25);
    expect(rows.map((row) => row.body.trimEnd()).join("")).toBe(text);
    for (const row of rows) expect(displayWidth(row.text)).toBeLessThanOrEqual(25);
  });

  it("draws a closed mermaid fence as a diagram", () => {
    const rows = paintTranscript(
      [
        {
          key: "m",
          kind: "assistant",
          text: "```mermaid\nflowchart LR\n  Client[Client] --> API[API]\n```",
        },
      ],
      80,
    );
    const picture = rows.map((row) => row.body).join("\n");
    expect(picture).toContain("Client");
    expect(picture).toContain("API");
    expect(picture).not.toContain("flowchart");
    expect(/[┌┐└┘│]|[+][-]/.test(picture)).toBe(true);
  });

  it("leaves an unfinished mermaid fence as source", () => {
    const rows = paintTranscript(
      [{ key: "m", kind: "assistant", text: "```mermaid\nflowchart LR\n  A --> B", streaming: true }],
      80,
    );
    expect(rows.map((row) => row.body).join("\n")).toContain("flowchart");
  });

  it("keeps a notice background on the text instead of the whole row", () => {
    const rows = paintTranscript(
      [{ key: "n", kind: "notice", text: "move the old file" }],
      32,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.gutter).toBe("note ");
    expect(rows[0]?.body).toBe("move the old file ");
    expect(displayWidth(rows[0]!.text)).toBe(23);

    const filled = paintTranscript(
      [{ key: "n", kind: "notice", text: "x".repeat(80) }],
      20,
    );
    expect(filled.length).toBeGreaterThan(1);
    for (const row of filled) expect(displayWidth(row.text)).toBeLessThanOrEqual(20);
    expect(displayWidth(filled[0]!.body)).toBe(15);
  });

  it("uses 1 row between tool/thinking blocks and 2 rows everywhere else", () => {
    expect(gapBefore("thinking", "tool")).toBe(SIDE_BLOCK_GAP);
    expect(gapBefore("tool", "thinking")).toBe(SIDE_BLOCK_GAP);
    expect(gapBefore("thinking", "thinking")).toBe(SIDE_BLOCK_GAP);
    expect(gapBefore("tool", "tool")).toBe(SIDE_BLOCK_GAP);
    expect(gapBefore("tool", "tool-result")).toBe(0);
    expect(gapBefore("tool", "tool-error")).toBe(0);
    expect(gapBefore("user", "thinking")).toBe(BLOCK_GAP);
    expect(gapBefore("thinking", "assistant")).toBe(BLOCK_GAP);
    expect(gapBefore("tool-result", "assistant")).toBe(BLOCK_GAP);
    expect(gapBefore("assistant", "user")).toBe(BLOCK_GAP);
    expect(gapBefore("user", "assistant")).toBe(BLOCK_GAP);
    expect(gapBefore(undefined, "user")).toBe(0);

    const rows = paintTranscript(
      [
        { key: "u1", kind: "user", text: "run it" },
        { key: "th", kind: "thinking", text: "plan" },
        { key: "t", kind: "tool", text: "bash  ls" },
        { key: "r", kind: "tool-result", text: "ok" },
        { key: "a", kind: "assistant", text: "done" },
        { key: "u2", kind: "user", text: "again" },
      ],
      40,
    );
    expect(rows.map((row) => row.kind)).toEqual([
      "user",
      "gap",
      "gap",
      "thinking",
      "gap",
      "tool",
      "tool-result",
      "gap",
      "gap",
      "assistant",
      "gap",
      "gap",
      "user",
    ]);
  });
});

describe("createPaintCache", () => {
  it("keeps unchanged rows and only relayouts the growing reply", () => {
    const cache = createPaintCache();
    const first = cache.paint(
      [
        { key: "u", kind: "user", text: "hello" },
        { key: "stream", kind: "assistant", text: "ab", streaming: true },
      ],
      40,
    );
    const second = cache.paint(
      [
        { key: "u", kind: "user", text: "hello" },
        { key: "stream", kind: "assistant", text: "abcdef", streaming: true },
      ],
      40,
    );
    expect(second[0]).toBe(first[0]);
    expect(second.map((row) => row.body).join("")).toContain("abcdef");
    expect(second.at(-1)).not.toBe(first.at(-1));
  });
});

describe("activityFor", () => {
  it("uses thinking, tool calling, or working", () => {
    expect(
      activityFor({ status: "running", streaming: false, toolName: null, continuing: false }),
    ).toMatchObject({ phase: "thinking", label: "Thinking" });
    expect(
      activityFor({ status: "running", streaming: true, toolName: null, continuing: false }),
    ).toMatchObject({ phase: "working", label: "Working" });
    expect(
      activityFor({ status: "running", streaming: false, toolName: null, continuing: true }),
    ).toMatchObject({ phase: "working", label: "Working" });
    expect(
      activityFor({ status: "running", streaming: true, toolName: "bash", continuing: false }),
    ).toMatchObject({ phase: "tool", label: "Tool calling" });
    expect(
      activityFor({ status: "asking", streaming: false, toolName: "bash", continuing: false }),
    ).toBeNull();
    expect(
      activityFor({ status: "idle", streaming: false, toolName: null, continuing: false }),
    ).toBeNull();
  });

  it("slides a short highlight across the status word", () => {
    expect(shineText("thinking", -1).every((cell) => !cell.hot)).toBe(true);
    expect(shineText("thinking", 0).map((cell) => cell.hot)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(shineText("thinking", 1).map((cell) => cell.hot)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    const swept = shineText("thinking", 3).flatMap((cell) => (cell.hot ? cell.text : ""));
    expect(swept.join("")).toBe("in");
    expect(shineText("thinking", "thinking".length + 1).some((cell) => cell.hot)).toBe(false);
    expect(shineText("thinking", "thinking".length + 2)[0]?.hot).toBe(true);
  });
});
