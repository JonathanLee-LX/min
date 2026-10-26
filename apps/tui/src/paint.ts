import { renderMermaidLines } from "./mermaid.js";
import {
  renderContent,
  type RenderBlock,
  type RenderRole,
  type RenderSpan,
  type SpanTone,
} from "./render.js";
import { defaultTheme, type TuiTheme } from "./theme.js";
import type { LogKind } from "./transcript.js";
import { displayWidth, wrapText } from "./text.js";

export type { LineTone } from "./theme.js";
export { toneFor } from "./theme.js";

const CHROME_LABELS: Partial<Record<Exclude<LogKind, "gap">, string>> = {
  error: "err",
  notice: "note",
  sys: "sys",
};

export interface TranscriptSource {
  key: string;
  kind: LogKind;
  text: string;
  /** Assistant text that is still streaming. The caret is drawn after Markdown. */
  streaming?: boolean;
}

export interface PaintedSpan {
  text: string;
  tone: SpanTone;
  bold: boolean;
}

export interface PaintedRow {
  key: string;
  kind: LogKind;
  /** First visual row of a message carries the speaker label. */
  lead: boolean;
  gutter: string;
  body: string;
  /** Full row, used by the viewport measurer. */
  text: string;
  spans: PaintedSpan[];
}

function frameFor(
  kind: Exclude<LogKind, "gap">,
  columns: number,
  theme: TuiTheme,
): { gutter: string; blank: string; bodyWidth: number } {
  const { frames } = theme;
  if (kind === "user" || kind === "assistant") {
    const gutter = frames.chatBar;
    const width = displayWidth(gutter);
    return { gutter, blank: gutter, bodyWidth: Math.max(1, columns - width) };
  }
  if (kind === "tool-result" || kind === "tool-error") {
    const gutter = frames.toolResult;
    const width = displayWidth(gutter);
    return { gutter, blank: gutter, bodyWidth: Math.max(1, columns - width) };
  }
  if (kind === "tool") {
    const gutter = frames.toolMarker;
    const width = displayWidth(gutter);
    return { gutter, blank: " ".repeat(width), bodyWidth: Math.max(1, columns - width) };
  }
  const chromeWidth = Math.max(1, frames.chromeWidth);
  const label = (CHROME_LABELS[kind] ?? "·").padEnd(chromeWidth, " ");
  return {
    gutter: label,
    blank: " ".repeat(chromeWidth),
    bodyWidth: Math.max(1, columns - chromeWidth),
  };
}

/** Pad a body so a background color fills the block. */
export function padToWidth(text: string, width: number): string {
  const used = displayWidth(text);
  if (used >= width) return text;
  return text + " ".repeat(width - used);
}

/** Blank line before each new user or assistant turn. */
export function separateTurns(lines: readonly TranscriptSource[]): TranscriptSource[] {
  const out: TranscriptSource[] = [];
  let prev: LogKind | undefined;
  for (const line of lines) {
    if (prev && isTurn(line.kind) && line.kind !== prev) {
      out.push({ key: `${line.key}:gap`, kind: "gap", text: "" });
    }
    out.push(line);
    if (line.kind !== "gap") prev = line.kind;
  }
  return out;
}

export function paintTranscript(
  lines: readonly TranscriptSource[],
  columns: number,
  theme: TuiTheme = defaultTheme,
): PaintedRow[] {
  const rows: PaintedRow[] = [];
  for (const line of separateTurns(lines)) rows.push(...paintOne(line, columns, theme));
  return rows;
}

/**
 * Reuse rows whose text did not change. Streaming then lays out only the
 * growing reply, not the history above it.
 */
export function createPaintCache(theme: TuiTheme = defaultTheme): {
  paint(lines: readonly TranscriptSource[], columns: number): PaintedRow[];
} {
  const cache = new Map<string, { sig: string; rows: PaintedRow[] }>();
  return {
    paint(lines, columns) {
      const seen = new Set<string>();
      const rows: PaintedRow[] = [];
      for (const line of separateTurns(lines)) {
        seen.add(line.key);
        const sig = `${theme.id}\0${columns}\0${line.kind}\0${line.streaming === true ? "1" : "0"}\0${line.text}`;
        const cached = cache.get(line.key);
        if (cached?.sig === sig) {
          rows.push(...cached.rows);
          continue;
        }
        const painted = paintOne(line, columns, theme);
        cache.set(line.key, { sig, rows: painted });
        rows.push(...painted);
      }
      for (const key of cache.keys()) {
        if (!seen.has(key)) cache.delete(key);
      }
      return rows;
    },
  };
}

function paintOne(line: TranscriptSource, columns: number, theme: TuiTheme): PaintedRow[] {
  if (line.kind === "gap") {
    return [
      {
        key: line.key,
        kind: "gap",
        lead: false,
        gutter: "",
        body: " ",
        text: " ",
        spans: [],
      },
    ];
  }
  const { gutter, blank, bodyWidth } = frameFor(line.kind, columns, theme);
  const blocks = renderContent({
    role: roleFor(line.kind),
    text: line.text,
    streaming: line.streaming === true,
  });
  const rows = paintBlocks(line, blocks, gutter, blank, bodyWidth);
  for (const row of rows) fillRowWidth(row, bodyWidth);
  if (!line.streaming) return rows;
  return appendCaret(rows, line, gutter, blank, bodyWidth);
}

function fillRowWidth(row: PaintedRow, bodyWidth: number): void {
  const used = displayWidth(row.body);
  if (used >= bodyWidth) {
    row.text = row.gutter + row.body;
    return;
  }
  const pad = " ".repeat(bodyWidth - used);
  row.body += pad;
  row.spans.push({ text: pad, tone: "plain", bold: false });
  row.text = row.gutter + row.body;
}

function roleFor(kind: LogKind): RenderRole {
  if (kind === "assistant") return "assistant";
  if (kind === "user") return "user";
  if (kind === "tool") return "tool";
  if (kind === "tool-result") return "tool-result";
  if (kind === "tool-error") return "tool-error";
  if (kind === "error") return "error";
  if (kind === "notice") return "notice";
  return "sys";
}

function paintBlocks(
  line: TranscriptSource,
  blocks: readonly RenderBlock[],
  gutter: string,
  blank: string,
  bodyWidth: number,
): PaintedRow[] {
  const rows: PaintedRow[] = [];
  const push = (spans: PaintedSpan[]) => {
    const body = spans.map((span) => span.text).join("") || " ";
    const lead = rows.length === 0;
    const prefix = lead ? gutter : blank;
    const painted = spans.length > 0 ? spans : [{ text: body, tone: "plain" as const, bold: false }];
    rows.push({
      key: `${line.key}:${rows.length}`,
      kind: line.kind,
      lead,
      gutter: prefix,
      body,
      text: prefix + body,
      spans: painted,
    });
  };

  for (const block of blocks) {
    if (block.kind === "rule") {
      push(paintSpans([{ text: "─".repeat(bodyWidth), tone: "dim" }], false));
      continue;
    }
    if (block.kind === "code") {
      const source = block.lines.map((spans) => spans.map((span) => span.text).join(""));
      if (isMermaid(block.lang) && block.closed) {
        const diagram = renderMermaidLines(source.join("\n"), bodyWidth);
        if (diagram) {
          pushDiagram(push, diagram);
          continue;
        }
      }
      if (block.lang) push(paintSpans([{ text: block.lang, tone: "dim" }], false));
      const codeLines = source.length > 0 ? source : [""];
      for (const codeLine of codeLines) {
        for (const wrapped of wrapText(codeLine.length > 0 ? codeLine : " ", bodyWidth)) {
          push(paintSpans([{ text: wrapped || " ", tone: "code" }], false));
        }
      }
      continue;
    }
    const bold = block.kind === "heading";
    for (const logical of block.lines) {
      const wrapped =
        block.kind === "list" ? wrapList(logical, bodyWidth) : wrapSpanRows(logical, bodyWidth);
      for (const row of wrapped) {
        push(block.kind === "quote" ? paintQuote(row) : paintSpans(row, bold));
      }
    }
  }
  if (rows.length === 0) push(paintSpans([{ text: " ", tone: "plain" }], false));
  return rows;
}

function isMermaid(lang: string | undefined): boolean {
  return lang?.trim().toLowerCase() === "mermaid";
}

function pushDiagram(push: (spans: PaintedSpan[]) => void, lines: readonly string[]): void {
  for (const line of lines) {
    push(paintSpans([{ text: line.length > 0 ? line : " ", tone: "plain" }], false));
  }
}

function appendCaret(
  rows: PaintedRow[],
  line: TranscriptSource,
  gutter: string,
  blank: string,
  bodyWidth: number,
): PaintedRow[] {
  const caret: PaintedSpan = { text: "▍", tone: "plain", bold: false };
  const last = rows[rows.length - 1];
  if (last) {
    // Drop the fill padding so the caret sits after the real text.
    trimFill(last);
    if (displayWidth(last.body) + displayWidth(caret.text) <= bodyWidth) {
      last.spans.push(caret);
      last.body += caret.text;
      fillRowWidth(last, bodyWidth);
      return rows;
    }
  }
  const prefix = rows.length === 0 ? gutter : blank;
  const row: PaintedRow = {
    key: `${line.key}:${rows.length}`,
    kind: line.kind,
    lead: rows.length === 0,
    gutter: prefix,
    body: caret.text,
    text: prefix + caret.text,
    spans: [caret],
  };
  fillRowWidth(row, bodyWidth);
  rows.push(row);
  return rows;
}

function trimFill(row: PaintedRow): void {
  while (row.spans.length > 0) {
    const last = row.spans[row.spans.length - 1]!;
    if (last.tone !== "plain" || !/^\s+$/.test(last.text)) break;
    row.spans.pop();
    row.body = row.body.slice(0, row.body.length - last.text.length);
  }
  row.text = row.gutter + row.body;
}

function paintSpans(spans: readonly RenderSpan[], bold: boolean): PaintedSpan[] {
  return spans
    .filter((span) => span.text.length > 0)
    .map((span) => ({
      text: span.text,
      tone: span.tone,
      bold: bold || span.tone === "strong",
    }));
}

function paintQuote(spans: readonly RenderSpan[]): PaintedSpan[] {
  return spans
    .filter((span) => span.text.length > 0)
    .map((span) => ({
      text: span.text,
      tone: span.tone === "code" || span.tone === "link" ? span.tone : "dim",
      bold: span.tone === "strong",
    }));
}

function wrapList(spans: readonly RenderSpan[], width: number): RenderSpan[][] {
  const marker = spans[0] ?? { text: "", tone: "plain" as const };
  const rest = spans.slice(1);
  const markerWidth = displayWidth(marker.text);
  const limit = Math.max(1, width);
  if (markerWidth >= limit) {
    return [[marker], ...wrapSpanRows(rest, limit)];
  }
  const content = wrapSpanRows(rest, limit - markerWidth);
  return content.map((row, index) =>
    index === 0 ? [marker, ...row] : [{ text: " ".repeat(markerWidth), tone: "plain" }, ...row],
  );
}

function wrapSpanRows(spans: readonly RenderSpan[], width: number): RenderSpan[][] {
  const limit = Math.max(1, width);
  const rows: RenderSpan[][] = [];
  let row: RenderSpan[] = [];
  let used = 0;
  const breakRow = () => {
    if (row.length === 0) return;
    rows.push(row);
    row = [];
    used = 0;
  };
  for (const span of spans) {
    let pending = span.text;
    while (pending.length > 0) {
      let take = "";
      let takeWidth = 0;
      for (const ch of pending) {
        const cell = displayWidth(ch);
        if (take && used + takeWidth + cell > limit) break;
        take += ch;
        takeWidth += cell;
        if (used + takeWidth >= limit) break;
      }
      if (!take) break;
      if (used > 0 && used + takeWidth > limit) breakRow();
      row.push({ text: take, tone: span.tone });
      used += takeWidth;
      pending = pending.slice(take.length);
      if (used >= limit) breakRow();
    }
  }
  if (row.length > 0) rows.push(row);
  if (rows.length === 0) rows.push([{ text: "", tone: "plain" }]);
  return rows;
}

function isTurn(kind: LogKind): boolean {
  return kind === "user" || kind === "assistant";
}

export type ActivityPhase = "thinking" | "writing" | "tool" | "continuing" | "approval";

export interface Activity {
  phase: ActivityPhase;
  label: string;
  frames: readonly string[];
  intervalMs: number;
  color: string;
}

const FRAMES: Record<ActivityPhase, readonly string[]> = {
  thinking: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  writing: ["▁", "▃", "▅", "▇", "▅", "▃"],
  tool: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"],
  continuing: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
  approval: ["◐", "◓", "◑", "◒"],
};

export function activityFrames(phase: ActivityPhase): readonly string[] {
  return FRAMES[phase];
}

export function activityFor(
  input: {
    status: "idle" | "running" | "asking";
    streaming: boolean;
    toolName: string | null;
    continuing: boolean;
  },
  theme: TuiTheme = defaultTheme,
): Activity | null {
  if (input.status === "asking") {
    return spec("approval", "waiting for approval", theme.activity.approval, 140);
  }
  if (input.status !== "running") return null;
  if (input.toolName) return spec("tool", clipLabel(input.toolName), theme.activity.tool, 80);
  if (input.streaming) return spec("writing", "writing", theme.activity.writing, 140);
  if (input.continuing) return spec("continuing", "continuing", theme.activity.continuing, 140);
  return spec("thinking", "thinking", theme.activity.thinking, 80);
}

export function frameChar(activity: Activity, frame: number): string {
  const frames = activity.frames;
  return frames[frame % frames.length] ?? frames[0] ?? "·";
}

function clipLabel(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= 36) return flat;
  return `${flat.slice(0, 33)}...`;
}

function spec(phase: ActivityPhase, label: string, color: string, intervalMs: number): Activity {
  const frames = FRAMES[phase];
  for (const frame of frames) {
    if (displayWidth(frame) !== 1) {
      throw new Error(`spinner frame ${frame} for ${phase} is not one cell wide`);
    }
  }
  return { phase, label, frames, intervalMs, color };
}
