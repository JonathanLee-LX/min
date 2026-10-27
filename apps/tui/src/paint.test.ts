import { describe, expect, it } from "vitest";
import {
  activityFor,
  activityFrames,
  activityLabel,
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

  it("opens a gap before a new turn", () => {
    const rows = paintTranscript(
      [
        { key: "t", kind: "tool", text: "bash  ls" },
        { key: "r", kind: "tool-result", text: "ok" },
        { key: "a", kind: "assistant", text: "done" },
      ],
      40,
    );
    expect(rows.map((row) => row.kind)).toEqual([
      "tool",
      "tool-result",
      "gap",
      "gap",
      "assistant",
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
  it("picks a different spinner for each running phase", () => {
    const thinking = activityFor({
      status: "running",
      streaming: false,
      toolName: null,
      continuing: false,
    });
    expect(thinking?.phase).toBe("thinking");
    expect(thinking?.labels.length).toBeGreaterThan(1);
    expect(thinking?.labels[0]).toBe("thinking");

    expect(
      activityFor({ status: "running", streaming: true, toolName: null, continuing: false })?.phase,
    ).toBe("writing");

    const tool = activityFor({
      status: "running",
      streaming: true,
      toolName: "bash",
      continuing: false,
    });
    expect(tool?.phase).toBe("tool");
    expect(tool?.labels).toEqual(["running bash", "using bash", "bash in progress"]);

    expect(
      activityFor({ status: "running", streaming: false, toolName: null, continuing: true })?.phase,
    ).toBe("continuing");
    expect(
      activityFor({ status: "asking", streaming: false, toolName: "bash", continuing: false })?.phase,
    ).toBe("approval");
    expect(
      activityFor({ status: "idle", streaming: false, toolName: null, continuing: false }),
    ).toBeNull();
  });

  it("rotates status copy across spinner frames", () => {
    const thinking = activityFor({
      status: "running",
      streaming: false,
      toolName: null,
      continuing: false,
    });
    expect(thinking).not.toBeNull();
    if (!thinking) return;
    const hold = thinking.labelHold;
    expect(activityLabel(thinking, 0)).toBe(thinking.labels[0]);
    expect(activityLabel(thinking, hold)).toBe(thinking.labels[1]);
    expect(activityLabel(thinking, hold * thinking.labels.length)).toBe(thinking.labels[0]);
  });

  it("uses one-cell frames so the label does not jump", () => {
    for (const phase of ["thinking", "writing", "tool", "continuing", "approval"] as const) {
      for (const frame of activityFrames(phase)) expect(displayWidth(frame)).toBe(1);
    }
  });
});
