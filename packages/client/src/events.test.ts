import { describe, expect, it } from "vitest";
import { createEventTranslator } from "./events.js";

describe("createEventTranslator", () => {
  it("maps text and tool events for UI", () => {
    const t = createEventTranslator();
    expect(t.push({ type: "text_delta", text: "hi" })).toEqual([
      { type: "assistant_delta", text: "hi" },
    ]);
    expect(
      t.push({
        type: "tool_call",
        toolCall: {
          type: "tool_call",
          id: "c1",
          name: "read_file",
          arguments: { path: "a" },
        },
      }),
    ).toEqual([
      {
        type: "tool_start",
        name: "read_file",
        args: { path: "a" },
        toolCallId: "c1",
      },
    ]);
    expect(
      t.push({
        type: "tool_result",
        toolCallId: "c1",
        content: "ok body",
        isError: false,
      }),
    ).toEqual([
      {
        type: "tool_end",
        toolCallId: "c1",
        name: "read_file",
        ok: true,
        preview: "ok body",
        content: "ok body",
      },
    ]);
    expect(t.push({ type: "turn_start", turn: 1 })).toEqual([]);
  });

  it("keeps the full tool output and clips only the one-line preview", () => {
    const t = createEventTranslator();
    t.push({
      type: "tool_call",
      toolCall: { type: "tool_call", id: "c1", name: "bash", arguments: {} },
    });
    const body = `alpha\n${"b".repeat(400)}`;
    const [event] = t.push({
      type: "tool_result",
      toolCallId: "c1",
      content: body,
      isError: false,
    });
    expect(event).toMatchObject({ type: "tool_end", content: body });
    if (event?.type !== "tool_end") throw new Error("expected tool_end");
    expect(event.preview.endsWith("...")).toBe(true);
    expect(event.preview.length).toBeLessThanOrEqual(200);
    expect(event.preview.includes("\n")).toBe(false);
  });
});
