import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { outlineDigest } from "./outline.js";
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

  it("spills a folded body to disk and keeps the value out of the marker", () => {
    const root = mkdtempSync(path.join(tmpdir(), "min-spill-"));
    const spillDir = path.join(root, ".min", "sessions", "ses_test", "outputs");
    const stash = createContextStash({ spillDir, spillRoot: root });
    const value = "min-eval-skill-7f3c";
    const entry = stash.put({
      kind: "tool_result",
      id: "tool_c1",
      content: `${"H".repeat(100)}\nTOKEN_SKILL=${value}\n`,
      toolName: "read_file",
    });
    expect(entry.file).toBe(".min/sessions/ses_test/outputs/tool_c1.txt");
    expect(readFileSync(path.join(root, entry.file!), "utf8")).toContain(value);
    const marker = hiddenMarker(entry.id, outlineDigest(entry));
    expect(marker).toContain("file=.min/sessions/ses_test/outputs/tool_c1.txt");
    expect(marker).toContain("key=TOKEN_SKILL@");
    expect(marker).not.toContain(value);
    expect(parseHiddenIds(marker)).toEqual(["tool_c1"]);
    stash.clear();
    expect(() => readFileSync(path.join(root, entry.file!), "utf8")).toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  it("parses hidden markers", () => {
    const text = `head${hiddenMarker("tool_c1")}tail`;
    expect(parseHiddenIds(text)).toEqual(["tool_c1"]);
  });
});
