import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
// CJS plugin; types ship as `export =` which doesn't match PluginSimple under NodeNext.
import multimdTable from "markdown-it-multimd-table";
import type { RenderBlock, RenderSpan, SpanTone, TableAlign } from "./types.js";

type MdPlugin = (markdown: MarkdownIt) => void;

const md = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: true,
  typographer: false,
}).use(multimdTable as unknown as MdPlugin);

/**
 * Parse Markdown into host-agnostic blocks via markdown-it tokens.
 * Streaming may leave fences / emphasis open; we balance markers so the
 * growing reply still paints with the intended tones.
 */
export function parseMarkdown(text: string, streaming = false): RenderBlock[] {
  const source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const prepared = streaming ? balanceStreamingMarkers(source) : source;
  const tokens = md.parse(prepared, {});
  const blocks = tokensToBlocks(tokens, prepared);
  if (blocks.length === 0) {
    return [{ kind: "paragraph", lines: [[{ text: "", tone: "plain" }]] }];
  }
  return blocks;
}

function tokensToBlocks(tokens: Token[], source: string): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    switch (token.type) {
      case "heading_open": {
        const level = Number(token.tag.slice(1)) || 1;
        const inline = tokens[index + 1];
        const lines =
          inline?.type === "inline"
            ? [inlineToSpans(inline)]
            : [[{ text: "", tone: "plain" as const }]];
        blocks.push({ kind: "heading", level, lines });
        index += 3;
        break;
      }
      case "paragraph_open": {
        const inline = tokens[index + 1];
        const lines =
          inline?.type === "inline"
            ? inlineToLines(inline)
            : [[{ text: "", tone: "plain" as const }]];
        blocks.push({ kind: "paragraph", lines });
        index += 3;
        break;
      }
      case "fence":
      case "code_block": {
        const lang = token.info?.trim() ?? "";
        const body = token.content.replace(/\n$/, "");
        const rows = body.length > 0 ? body.split("\n") : [""];
        blocks.push({
          kind: "code",
          closed: token.type === "code_block" ? true : fenceIsClosed(source, token),
          ...(lang ? { lang } : {}),
          lines: rows.map((row) => [{ text: row, tone: "plain" as const }]),
        });
        index += 1;
        break;
      }
      case "hr": {
        blocks.push({ kind: "rule", lines: [] });
        index += 1;
        break;
      }
      case "blockquote_open": {
        const { block, next } = readQuote(tokens, index);
        blocks.push(block);
        index = next;
        break;
      }
      case "bullet_list_open":
      case "ordered_list_open": {
        const { block, next } = readList(tokens, index);
        blocks.push(block);
        index = next;
        break;
      }
      case "table_open": {
        const { block, next } = readTable(tokens, index);
        blocks.push(block);
        index = next;
        break;
      }
      default:
        index += 1;
        break;
    }
  }
  return blocks;
}

function fenceIsClosed(source: string, token: Token): boolean {
  const map = token.map;
  if (!map) return true;
  const lines = source.split("\n");
  const last = lines[map[1] - 1] ?? "";
  return /^`{3,}\s*$/.test(last);
}

function readQuote(tokens: Token[], start: number): { block: RenderBlock; next: number } {
  const spans: RenderSpan[] = [];
  let index = start + 1;
  let depth = 1;
  while (index < tokens.length && depth > 0) {
    const token = tokens[index]!;
    if (token.type === "blockquote_open") depth += 1;
    else if (token.type === "blockquote_close") {
      depth -= 1;
      if (depth === 0) break;
    } else if (token.type === "inline") {
      if (spans.length > 0) spans.push({ text: " ", tone: "plain" });
      spans.push(...inlineToSpans(token));
    }
    index += 1;
  }
  return {
    block: {
      kind: "quote",
      lines: [mergeSpans(spans.length > 0 ? spans : [{ text: "", tone: "plain" }])],
    },
    next: index + 1,
  };
}

function readList(tokens: Token[], start: number): { block: RenderBlock; next: number } {
  const items: RenderSpan[][] = [];
  const ordered = tokens[start]!.type === "ordered_list_open";
  let index = start + 1;
  let depth = 1;
  let order = Number(tokens[start]!.attrGet("start") ?? "1") || 1;
  while (index < tokens.length && depth > 0) {
    const token = tokens[index]!;
    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      depth += 1;
      index += 1;
      continue;
    }
    if (token.type === "bullet_list_close" || token.type === "ordered_list_close") {
      depth -= 1;
      if (depth === 0) break;
      index += 1;
      continue;
    }
    if (token.type === "list_item_open" && depth === 1) {
      const markup = token.markup || "-";
      const marker = ordered ? `${order++}. ` : `${markup} `;
      const { spans, next } = readListItem(tokens, index + 1);
      // Keep the marker in its own span so TUI wrapList can indent continuations.
      items.push([{ text: marker, tone: "plain" }, ...mergeSpans(spans)]);
      index = next;
      continue;
    }
    index += 1;
  }
  return {
    block: {
      kind: "list",
      lines: items.length > 0 ? items : [[{ text: "- ", tone: "plain" }]],
    },
    next: index + 1,
  };
}

function readListItem(tokens: Token[], start: number): { spans: RenderSpan[]; next: number } {
  const spans: RenderSpan[] = [];
  let index = start;
  let depth = 1;
  while (index < tokens.length && depth > 0) {
    const token = tokens[index]!;
    if (token.type === "list_item_open") {
      depth += 1;
      index += 1;
      continue;
    }
    if (token.type === "list_item_close") {
      depth -= 1;
      if (depth === 0) return { spans, next: index + 1 };
      index += 1;
      continue;
    }
    if (token.type === "inline" && depth === 1) {
      if (spans.length > 0) spans.push({ text: " ", tone: "plain" });
      spans.push(...inlineToSpans(token));
    }
    index += 1;
  }
  return { spans, next: index };
}

function readTable(tokens: Token[], start: number): { block: RenderBlock; next: number } {
  const cells: RenderSpan[][][] = [];
  const aligns: Array<TableAlign | null> = [];
  let index = start + 1;
  let row: RenderSpan[][] = [];
  let inHeader = false;

  while (index < tokens.length) {
    const token = tokens[index]!;
    if (token.type === "table_close") {
      return {
        block: { kind: "table", lines: [], cells, aligns },
        next: index + 1,
      };
    }
    if (token.type === "thead_open") inHeader = true;
    if (token.type === "thead_close") inHeader = false;
    if (token.type === "tr_open") row = [];
    if (token.type === "tr_close") {
      if (row.length > 0) cells.push(row);
      row = [];
    }
    if (token.type === "th_open" || token.type === "td_open") {
      if (inHeader && token.type === "th_open") {
        aligns.push(alignFromStyle(token.attrGet("style")));
      }
      const inline = tokens[index + 1];
      const cell =
        inline?.type === "inline"
          ? inlineToSpans(inline)
          : [{ text: "", tone: "plain" as const }];
      row.push(cell);
      index += inline?.type === "inline" ? 2 : 1;
      continue;
    }
    index += 1;
  }
  return {
    block: { kind: "table", lines: [], cells, aligns },
    next: index,
  };
}

function alignFromStyle(style: string | null): TableAlign | null {
  if (!style) return null;
  if (style.includes("text-align:center")) return "center";
  if (style.includes("text-align:right")) return "right";
  if (style.includes("text-align:left")) return "left";
  return null;
}

function inlineToLines(token: Token): RenderSpan[][] {
  const children = token.children ?? [];
  const lines: RenderSpan[][] = [];
  let current: RenderSpan[] = [];
  const flushLine = () => {
    lines.push(mergeSpans(current.length > 0 ? current : [{ text: "", tone: "plain" }]));
    current = [];
  };
  const stack: SpanTone[] = [];
  const tone = (): SpanTone => {
    if (stack.includes("code")) return "code";
    if (stack.includes("link")) return "link";
    if (stack.includes("strong")) return "strong";
    if (stack.includes("em")) return "em";
    return "plain";
  };

  let i = 0;
  while (i < children.length) {
    const child = children[i]!;
    switch (child.type) {
      case "softbreak":
      case "hardbreak":
        flushLine();
        i += 1;
        break;
      case "strong_open":
        stack.push("strong");
        i += 1;
        break;
      case "strong_close":
        popTone(stack, "strong");
        i += 1;
        break;
      case "em_open":
        stack.push("em");
        i += 1;
        break;
      case "em_close":
        popTone(stack, "em");
        i += 1;
        break;
      case "code_inline":
        current.push({ text: child.content, tone: "code" });
        i += 1;
        break;
      case "link_open": {
        const href = child.attrGet("href") ?? "";
        const labelParts: string[] = [];
        i += 1;
        let depth = 1;
        while (i < children.length && depth > 0) {
          const next = children[i]!;
          if (next.type === "link_open") depth += 1;
          else if (next.type === "link_close") {
            depth -= 1;
            if (depth === 0) {
              i += 1;
              break;
            }
          } else if (depth === 1 && (next.type === "text" || next.type === "code_inline")) {
            labelParts.push(next.content);
          }
          if (depth > 0) i += 1;
        }
        const label = labelParts.join("");
        if (label) current.push({ text: label, tone: "plain" });
        if (href && href !== label) {
          current.push({ text: " ", tone: "plain" });
          current.push({ text: href, tone: "link" });
        }
        break;
      }
      case "text":
        if (child.content) current.push({ text: child.content, tone: tone() });
        i += 1;
        break;
      default:
        if (child.content) current.push({ text: child.content, tone: tone() });
        i += 1;
        break;
    }
  }
  flushLine();
  return lines;
}

function inlineToSpans(token: Token): RenderSpan[] {
  return mergeSpans(inlineToLines(token).flat());
}

function popTone(stack: SpanTone[], tone: SpanTone): void {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i] === tone) {
      stack.splice(i, 1);
      return;
    }
  }
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

/**
 * While the model is still streaming, close dangling emphasis / inline code
 * so markdown-it paints the open run with the right tone.
 */
function balanceStreamingMarkers(text: string): string {
  const masked = maskFences(text);
  let suffix = "";
  if (countMarker(masked, "`") % 2 === 1) suffix += "`";
  const afterTicks = masked + (suffix.includes("`") ? "\0" : "");
  if (countMarker(afterTicks, "**") % 2 === 1) suffix += "**";
  else if (countSingleEmphasis(afterTicks) % 2 === 1) suffix += "*";
  return text + suffix;
}

function maskFences(text: string): string {
  return text.replace(/^```[\s\S]*?(?:^```\s*$|$)/gm, (block) => "\0".repeat(block.length));
}

function countMarker(text: string, marker: string): number {
  let count = 0;
  let index = 0;
  while (index < text.length) {
    if (text.startsWith(marker, index)) {
      count += 1;
      index += marker.length;
      continue;
    }
    index += 1;
  }
  return count;
}

function countSingleEmphasis(text: string): number {
  let count = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "*") {
      index += 1;
      continue;
    }
    let run = 0;
    while (text[index + run] === "*") run += 1;
    count += run % 2;
    index += run;
  }
  return count;
}
