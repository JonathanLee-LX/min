import { describe, expect, it } from "vitest";
import {
  createContextStash,
  hiddenMarker,
  parseHiddenIds,
} from "./stash.js";

describe("ContextStash", () => {
  it("stores and lists entries by stable tool id", () => {
    const stash = createContextStash();
    const a = stash.put({
      kind: "tool_result",
      content: "hello world",
      toolCallId: "c1",
      toolName: "bash",
      id: "tool_c1",
    });
    expect(a.id).toBe("tool_c1");
    expect(stash.get("tool_c1")?.content).toBe("hello world");
    expect(stash.list()).toHaveLength(1);

    stash.put({
      kind: "tool_result",
      content: "updated",
      toolCallId: "c1",
      id: "tool_c1",
    });
    expect(stash.get("tool_c1")?.content).toBe("updated");
    expect(stash.size).toBe(1);
  });

  it("parses hidden markers", () => {
    const text = `head${hiddenMarker("tool_c1")}tail`;
    expect(parseHiddenIds(text)).toEqual(["tool_c1"]);
  });
});
