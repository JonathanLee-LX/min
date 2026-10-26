import { describe, expect, it } from "vitest";
import { paintTranscript } from "./paint.js";
import { renderContent, type RenderContent } from "./render.js";

describe("renderContent", () => {
  it("renders assistant markdown and leaves other roles raw", () => {
    const heading = renderContent({ role: "assistant", text: "## Title", streaming: false });
    expect(heading[0]).toMatchObject({ kind: "heading", level: 2 });
    expect(heading[0]?.lines[0]?.[0]).toEqual({ text: "Title", tone: "plain" });

    const raw = renderContent({ role: "tool", text: "**not** markdown", streaming: false });
    expect(raw[0]?.kind).toBe("raw");
    expect(raw[0]?.lines[0]?.[0]?.text).toBe("**not** markdown");
  });

  it("splits emphasis, inline code, and links", () => {
    const [block] = renderContent({
      role: "assistant",
      text: "See **bold** and `code` plus [docs](https://example.com).",
      streaming: false,
    });
    expect(block?.lines[0]?.map((span) => `${span.tone}:${span.text}`)).toEqual([
      "plain:See ",
      "strong:bold",
      "plain: and ",
      "code:code",
      "plain: plus docs ",
      "link:https://example.com",
      "plain:.",
    ]);
  });

  it("keeps an unclosed marker open", () => {
    const [bold] = renderContent({ role: "assistant", text: "Say **hello", streaming: true });
    expect(bold?.lines[0]?.map((span) => span.tone)).toContain("strong");
    const [fence] = renderContent({
      role: "assistant",
      text: "```ts\nconst x = 1",
      streaming: true,
    });
    expect(fence).toMatchObject({ kind: "code", lang: "ts" });
    expect(fence?.lines[0]?.[0]?.text).toBe("const x = 1");
  });

  it("closes a fence and keeps the code verbatim", () => {
    const blocks = renderContent({
      role: "assistant",
      text: "```ts\nconst x = 1\n```\nAfter",
      streaming: false,
    });
    expect(blocks.map((block) => block.kind)).toEqual(["code", "paragraph"]);
    expect(blocks[0]?.lines.map((line) => line[0]?.text)).toEqual(["const x = 1"]);
    expect(blocks[1]?.lines[0]?.[0]?.text).toBe("After");
  });

  it("lets a plugin replace assistant text and fall through otherwise", () => {
    const plugin: RenderContent = (req, next) => {
      if (req.text.startsWith("CUSTOM")) {
        return [{ kind: "paragraph", lines: [[{ text: "custom", tone: "plain" }]] }];
      }
      return next(req, next);
    };
    const custom = renderContent({ role: "assistant", text: "CUSTOM", streaming: false }, [plugin]);
    expect(custom[0]?.lines[0]?.[0]?.text).toBe("custom");
    const heading = renderContent({ role: "assistant", text: "# Hi", streaming: false }, [plugin]);
    expect(heading[0]?.kind).toBe("heading");
  });
});

describe("paint markdown", () => {
  it("indents wrapped list items and dims the code language", () => {
    const rows = paintTranscript(
      [{ key: "a", kind: "assistant", text: "- alpha beta gamma delta" }],
      16,
    );
    expect(rows[0]?.body.startsWith("- ")).toBe(true);
    expect(rows[1]?.body.startsWith("  ")).toBe(true);

    const code = paintTranscript(
      [{ key: "c", kind: "assistant", text: "```ts\nconst value = 1\n```" }],
      40,
    );
    expect(code[0]?.spans[0]).toMatchObject({ text: "ts", tone: "dim" });
    expect(code[1]?.body.trimEnd()).toBe("const value = 1");
    expect(code[1]?.spans[0]?.tone).toBe("code");
  });

  it("draws the streaming caret after the parsed text", () => {
    const rows = paintTranscript(
      [{ key: "s", kind: "assistant", text: "```\ncode", streaming: true }],
      40,
    );
    expect(rows.map((row) => row.body.trimEnd()).join("")).not.toContain("▍code");
    expect(rows[rows.length - 1]?.body.trimEnd().endsWith("▍")).toBe(true);
    expect(rows.some((row) => row.spans.some((span) => span.tone === "code" && span.text === "code"))).toBe(
      true,
    );
  });
});
