import { describe, expect, it } from "vitest";
import { renderContent, type RenderContent } from "./index.js";

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

  it("parses GFM tables without leaving pipe markdown", () => {
    const blocks = renderContent({
      role: "assistant",
      text: "| Name | Value |\n| --- | ---: |\n| **alpha** | 1 |\n| beta | 2 |",
      streaming: false,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("table");
    expect(blocks[0]?.aligns).toEqual([null, "right"]);
    expect(blocks[0]?.cells).toHaveLength(3);
    expect(blocks[0]?.cells?.[0]?.map((cell) => cell.map((span) => span.text).join(""))).toEqual([
      "Name",
      "Value",
    ]);
    expect(blocks[0]?.cells?.[1]?.[0]?.map((span) => `${span.tone}:${span.text}`)).toEqual([
      "strong:alpha",
    ]);
  });

  it("keeps hard line breaks and parses italic / ***", () => {
    const blocks = renderContent({
      role: "assistant",
      text: "**Files:**\na.ts\nb.ts",
      streaming: false,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("paragraph");
    expect(blocks[0]?.lines.map((line) => line.map((span) => span.text).join(""))).toEqual([
      "Files:",
      "a.ts",
      "b.ts",
    ]);
    expect(blocks[0]?.lines[0]?.[0]).toEqual({ text: "Files:", tone: "strong" });

    const italic = renderContent({
      role: "assistant",
      text: "Use *italic* here",
      streaming: false,
    });
    expect(italic[0]?.lines[0]?.map((span) => `${span.tone}:${span.text}`)).toEqual([
      "plain:Use ",
      "em:italic",
      "plain: here",
    ]);

    const both = renderContent({
      role: "assistant",
      text: "***both***",
      streaming: false,
    });
    expect(both[0]?.lines[0]?.[0]).toEqual({ text: "both", tone: "strong" });
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
    expect(fence?.closed).toBe(false);
  });

  it("closes a fence and keeps the code verbatim", () => {
    const blocks = renderContent({
      role: "assistant",
      text: "```ts\nconst x = 1\n```\nAfter",
      streaming: false,
    });
    expect(blocks.map((block) => block.kind)).toEqual(["code", "paragraph"]);
    expect(blocks[0]?.lines.map((line) => line[0]?.text)).toEqual(["const x = 1"]);
    expect(blocks[0]?.closed).toBe(true);
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
