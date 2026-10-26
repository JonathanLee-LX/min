/**
 * Content rendering for the TUI.
 *
 * TODO(render-package): extract this file to `@min-agent/render` when Web
 * calls the same `renderContent`. Keep it free of Ink, React, and column
 * wrapping so the move is an import change. Hosts paint `RenderBlock`s.
 */

export type RenderRole =
  | "user"
  | "assistant"
  | "tool"
  | "tool-result"
  | "tool-error"
  | "error"
  | "notice"
  | "sys";

export interface RenderRequest {
  role: RenderRole;
  text: string;
  /** The reply is still growing. Unclosed markers stay open either way. */
  streaming: boolean;
}

export type SpanTone = "plain" | "strong" | "code" | "dim" | "link";

export interface RenderSpan {
  text: string;
  tone: SpanTone;
}

export type BlockKind = "paragraph" | "heading" | "code" | "list" | "quote" | "rule" | "raw";

export interface RenderBlock {
  kind: BlockKind;
  /** Logical lines. Wrapping to the terminal width is the host's job. */
  lines: RenderSpan[][];
  lang?: string;
  level?: number;
  /** A fence had its closing marker. Unclosed fences stay source text. */
  closed?: boolean;
}

/** Return the blocks for this request, or call `next` to pass it on. */
export type RenderContent = (req: RenderRequest, next: RenderContent) => RenderBlock[];

const fallbackRenderer: RenderContent = (req) => plainRenderer(req, fallbackRenderer);

/**
 * Plugins run first. The built-in Markdown renderer handles assistant text.
 * Everything else stays raw.
 */
export function renderContent(
  req: RenderRequest,
  plugins: readonly RenderContent[] = [],
): RenderBlock[] {
  const chain = [...plugins, markdownRenderer];
  let next: RenderContent = fallbackRenderer;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const current = chain[index]!;
    const after = next;
    next = (request) => current(request, after);
  }
  return next(req, fallbackRenderer);
}

export function markdownRenderer(req: RenderRequest, next: RenderContent): RenderBlock[] {
  if (req.role !== "assistant") return next(req, next);
  return parseMarkdown(req.text);
}

export function plainRenderer(req: RenderRequest, _next: RenderContent): RenderBlock[] {
  const lines = req.text.split("\n").map((line) => [{ text: line, tone: "plain" as const }]);
  return [{ kind: "raw", lines: lines.length > 0 ? lines : [[{ text: "", tone: "plain" }]] }];
}

function parseMarkdown(text: string): RenderBlock[] {
  const source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = source.split("\n");
  const blocks: RenderBlock[] = [];
  let index = 0;
  while (index < rows.length) {
    const line = rows[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      const lang = fence[1]?.trim() ?? "";
      const body: string[] = [];
      index += 1;
      while (index < rows.length && !/^```\s*$/.test(rows[index] ?? "")) {
        body.push(rows[index] ?? "");
        index += 1;
      }
      const closed = index < rows.length && /^```\s*$/.test(rows[index] ?? "");
      if (closed) index += 1;
      blocks.push({
        kind: "code",
        closed,
        ...(lang ? { lang } : {}),
        lines: (body.length > 0 ? body : [""]).map((row) => [{ text: row, tone: "plain" }]),
      });
      continue;
    }
    const heading = /^(#{1,6})[ \t]+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1]!.length,
        lines: [parseInline(heading[2] ?? "")],
      });
      index += 1;
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: "rule", lines: [] });
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < rows.length && /^>\s?/.test(rows[index] ?? "")) {
        quoted.push((rows[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", lines: [parseInline(quoted.join(" "))] });
      continue;
    }
    if (isListLine(line)) {
      const items: RenderSpan[][] = [];
      while (index < rows.length && isListLine(rows[index] ?? "")) {
        const item = parseListLine(rows[index] ?? "");
        const content: RenderSpan[] = [...parseInline(item.text)];
        index += 1;
        while (
          index < rows.length &&
          /^\s+\S/.test(rows[index] ?? "") &&
          !isBlockStart(rows[index] ?? "")
        ) {
          content.push({ text: " ", tone: "plain" });
          content.push(...parseInline((rows[index] ?? "").trim()));
          index += 1;
        }
        items.push([{ text: item.marker, tone: "plain" }, ...mergeSpans(content)]);
      }
      blocks.push({ kind: "list", lines: items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < rows.length) {
      const current = rows[index] ?? "";
      if (!current.trim() || isBlockStart(current)) break;
      paragraph.push(current.trim());
      index += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", lines: [parseInline(paragraph.join(" "))] });
    }
  }
  if (blocks.length === 0) {
    return [{ kind: "paragraph", lines: [[{ text: "", tone: "plain" }]] }];
  }
  return blocks;
}

function isBlockStart(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^#{1,6}[ \t]+/.test(line) ||
    /^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^>\s?/.test(line) ||
    isListLine(line)
  );
}

function isListLine(line: string): boolean {
  return /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/.test(line);
}

function parseListLine(line: string): { marker: string; text: string } {
  const match = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)(.*)$/.exec(line);
  if (!match) return { marker: "", text: line };
  return { marker: match[1] ?? "", text: match[2] ?? "" };
}

function parseInline(input: string): RenderSpan[] {
  const spans: RenderSpan[] = [];
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    spans.push({ text: buffer, tone: "plain" });
    buffer = "";
  };
  let index = 0;
  while (index < input.length) {
    const marker = input.startsWith("**", index) ? "**" : input.startsWith("__", index) ? "__" : "";
    if (marker) {
      const close = input.indexOf(marker, index + marker.length);
      flush();
      if (close === -1) {
        const rest = input.slice(index + marker.length);
        if (rest) spans.push({ text: rest, tone: "strong" });
        return mergeSpans(spans);
      }
      for (const span of parseInline(input.slice(index + marker.length, close))) {
        spans.push(span.tone === "plain" ? { text: span.text, tone: "strong" } : span);
      }
      index = close + marker.length;
      continue;
    }
    if (input[index] === "`") {
      const close = input.indexOf("`", index + 1);
      flush();
      if (close === -1) {
        const rest = input.slice(index + 1);
        if (rest) spans.push({ text: rest, tone: "code" });
        return mergeSpans(spans);
      }
      spans.push({ text: input.slice(index + 1, close), tone: "code" });
      index = close + 1;
      continue;
    }
    const link = input[index] === "[" ? matchLink(input, index) : null;
    if (link) {
      flush();
      spans.push({ text: link.label, tone: "plain" });
      if (link.url && link.url !== link.label) {
        spans.push({ text: " ", tone: "plain" });
        spans.push({ text: link.url, tone: "link" });
      }
      index = link.end;
      continue;
    }
    buffer += input[index] ?? "";
    index += 1;
  }
  flush();
  return mergeSpans(spans.length > 0 ? spans : [{ text: "", tone: "plain" }]);
}

function matchLink(
  input: string,
  index: number,
): { label: string; url: string; end: number } | null {
  const closeLabel = input.indexOf("]", index + 1);
  if (closeLabel < 0 || input[closeLabel + 1] !== "(") return null;
  const closeUrl = input.indexOf(")", closeLabel + 2);
  if (closeUrl < 0) return null;
  const label = input.slice(index + 1, closeLabel);
  const url = input.slice(closeLabel + 2, closeUrl).trim();
  if (!label) return null;
  return { label, url, end: closeUrl + 1 };
}

function mergeSpans(spans: readonly RenderSpan[]): RenderSpan[] {
  const merged: RenderSpan[] = [];
  for (const span of spans) {
    if (!span.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.tone === span.tone) last.text += span.text;
    else merged.push({ text: span.text, tone: span.tone });
  }
  return merged.length > 0 ? merged : [{ text: "", tone: "plain" }];
}
