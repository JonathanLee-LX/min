import { describe, expect, it } from "vitest";
import { activityFor, activityFrames, createPaintCache, paintTranscript } from "./paint.js";
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
  it("puts a speaker gutter on the first row and indents the wrap", () => {
    const rows = paintTranscript(
      [
        { key: "u", kind: "user", text: "hello" },
        { key: "a", kind: "assistant", text: "a".repeat(40) },
      ],
      20,
    );
    expect(rows[0]).toMatchObject({ kind: "user", lead: true, gutter: "you  ", body: "hello" });
    const assistant = rows.filter((row) => row.kind === "assistant");
    expect(assistant.length).toBe(3);
    expect(assistant[0]?.lead).toBe(true);
    expect(assistant[0]?.gutter.startsWith("min")).toBe(true);
    expect(assistant[1]?.gutter).toBe("     ");
    expect(assistant[1]?.body.length).toBe(15);
    const layout = layoutViewport(rows, 20, 50, 0);
    expect(layout.total).toBe(rows.length);
  });

  it("keeps a long answer by wrapping instead of dropping the tail", () => {
    const text = "a".repeat(100);
    const rows = paintTranscript([{ key: "a", kind: "assistant", text }], 25);
    expect(rows.map((row) => row.body).join("")).toBe(text);
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
    expect(rows.map((row) => row.kind)).toEqual(["tool", "tool-result", "gap", "assistant"]);
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
    expect(
      activityFor({ status: "running", streaming: false, toolName: null, continuing: false })?.phase,
    ).toBe("thinking");
    expect(
      activityFor({ status: "running", streaming: true, toolName: null, continuing: false })?.phase,
    ).toBe("writing");
    expect(
      activityFor({ status: "running", streaming: true, toolName: "bash", continuing: false })?.label,
    ).toBe("bash");
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

  it("uses one-cell frames so the label does not jump", () => {
    for (const phase of ["thinking", "writing", "tool", "continuing", "approval"] as const) {
      for (const frame of activityFrames(phase)) expect(displayWidth(frame)).toBe(1);
    }
  });
});
