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

export type SpanTone = "plain" | "strong" | "em" | "code" | "dim" | "link";

export interface RenderSpan {
  text: string;
  tone: SpanTone;
}

export type BlockKind =
  | "paragraph"
  | "heading"
  | "code"
  | "list"
  | "quote"
  | "rule"
  | "table"
  | "raw";

export type TableAlign = "left" | "center" | "right";

export interface RenderBlock {
  kind: BlockKind;
  /** Logical lines. Wrapping to the terminal width is the host's job. */
  lines: RenderSpan[][];
  lang?: string;
  level?: number;
  /** A fence had its closing marker. Unclosed fences stay source text. */
  closed?: boolean;
  /**
   * GFM table cells: `cells[row][col]` → inline spans.
   * Row 0 is the header. Only set when `kind === "table"`.
   */
  cells?: RenderSpan[][][];
  /** Per-column alignment from the separator row. */
  aligns?: Array<TableAlign | null>;
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
    // GFM table: header row + separator (`| --- | --- |`) + body rows.
    if (isTableRow(line) && isTableSeparator(rows[index + 1] ?? "")) {
      const headerCells = splitTableRow(line);
      const aligns = parseTableAligns(rows[index + 1] ?? "", headerCells.length);
      index += 2;
      const cells: RenderSpan[][][] = [headerCells.map((cell) => parseInline(cell))];
      while (index < rows.length) {
        const current = rows[index] ?? "";
        if (!current.trim() || !isTableRow(current) || isTableSeparator(current)) break;
        if (isBlockStart(current) && !isTableRow(current)) break;
        const rowCells = splitTableRow(current);
        while (rowCells.length < headerCells.length) rowCells.push("");
        cells.push(
          rowCells.slice(0, headerCells.length).map((cell) => parseInline(cell)),
        );
        index += 1;
      }
      blocks.push({ kind: "table", lines: [], cells, aligns });
      continue;
    }
    const paragraph: string[] = [];
    while (index < rows.length) {
      const current = rows[index] ?? "";
      if (!current.trim() || isBlockStart(current)) break;
      // Don't swallow a GFM table that starts on this line.
      if (isTableRow(current) && isTableSeparator(rows[index + 1] ?? "")) break;
      // Keep hard line breaks — models often structure replies without
      // blank lines between short lines; joining with spaces flattens them.
      paragraph.push(current.trimEnd().replace(/^[ \t]+/, ""));
      index += 1;
    }
    if (paragraph.length > 0) {
      blocks.push({
        kind: "paragraph",
        lines: paragraph.map((row) => parseInline(row)),
      });
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

/** A pipe-separated row that can start or continue a GFM table. */
function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("```")) return false;
  // Need at least one pipe and some cell text (avoid bare "|").
  if (!trimmed.includes("|")) return false;
  return splitTableRow(trimmed).some((cell) => cell.length > 0);
}

/** Separator row: `| --- | :---: | ---: |` (pipes optional at ends). */
function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(trimmed) ||
    /^(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*$/.test(trimmed);
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

function parseTableAligns(separator: string, columns: number): Array<TableAlign | null> {
  const cells = splitTableRow(separator);
  const aligns: Array<TableAlign | null> = [];
  for (let i = 0; i < columns; i++) {
    const cell = (cells[i] ?? "").replace(/\s+/g, "");
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) aligns.push("center");
    else if (right) aligns.push("right");
    else if (left) aligns.push("left");
    else aligns.push(null);
  }
  return aligns;
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
    // *** / ___ → strong + emphasis
    const triple = input.startsWith("***", index)
      ? "***"
      : input.startsWith("___", index)
        ? "___"
        : "";
    if (triple) {
      const close = input.indexOf(triple, index + triple.length);
      flush();
      if (close === -1) {
        const rest = input.slice(index + triple.length);
        if (rest) spans.push({ text: rest, tone: "strong" });
        return mergeSpans(spans);
      }
      for (const span of parseInline(input.slice(index + triple.length, close))) {
        spans.push(promoteTone(span, "strong"));
      }
      index = close + triple.length;
      continue;
    }
    const strong = input.startsWith("**", index) ? "**" : input.startsWith("__", index) ? "__" : "";
    if (strong) {
      const close = input.indexOf(strong, index + strong.length);
      flush();
      if (close === -1) {
        const rest = input.slice(index + strong.length);
        if (rest) spans.push({ text: rest, tone: "strong" });
        return mergeSpans(spans);
      }
      for (const span of parseInline(input.slice(index + strong.length, close))) {
        spans.push(promoteTone(span, "strong"));
      }
      index = close + strong.length;
      continue;
    }
    // Single *emphasis* only (avoid `_snake_case_` false positives).
    if (input[index] === "*" && canOpenEmphasis(input, index)) {
      const close = findEmphasisClose(input, index + 1, "*");
      flush();
      if (close === -1) {
        const rest = input.slice(index + 1);
        if (rest) spans.push({ text: rest, tone: "em" });
        return mergeSpans(spans);
      }
      for (const span of parseInline(input.slice(index + 1, close))) {
        spans.push(promoteTone(span, "em"));
      }
      index = close + 1;
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

function promoteTone(span: RenderSpan, tone: Extract<SpanTone, "strong" | "em">): RenderSpan {
  if (span.tone === "code" || span.tone === "link" || span.tone === "dim") return span;
  if (tone === "strong") return { text: span.text, tone: "strong" };
  if (span.tone === "strong") return span;
  return { text: span.text, tone: "em" };
}

function canOpenEmphasis(input: string, index: number): boolean {
  const next = input[index + 1];
  if (!next || next === "*" || next === " " || next === "\t") return false;
  return true;
}

function findEmphasisClose(input: string, from: number, marker: string): number {
  let index = from;
  while (index < input.length) {
    if (input[index] !== marker) {
      index += 1;
      continue;
    }
    // Skip ** inside *...* search.
    if (input.startsWith(marker + marker, index)) {
      index += 2;
      continue;
    }
    const prev = input[index - 1];
    if (prev === " " || prev === "\t") {
      index += 1;
      continue;
    }
    return index;
  }
  return -1;
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
