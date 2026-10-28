import { renderMermaidLines } from "./mermaid.js";
import {
  renderContent,
  type RenderBlock,
  type RenderRole,
  type RenderSpan,
  type SpanTone,
  type TableAlign,
} from "./render.js";
import { defaultTheme, type TuiTheme } from "./theme.js";
import { foldToolOutput } from "./tool-fold.js";
import type { LogKind } from "./transcript.js";
import { displayWidth, wrapText } from "./text.js";

export type { LineTone } from "./theme.js";
export { toneFor } from "./theme.js";

export interface PaintOptions {
  /** When false (default), multi-line tool output collapses to one summary line. */
  toolOutputExpanded?: boolean;
}

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
  italic: boolean;
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
  // Reasoning stream: quiet indent, no "think" chrome label.
  if (kind === "thinking") {
    const gutter = "  ";
    const width = displayWidth(gutter);
    return { gutter, blank: gutter, bodyWidth: Math.max(1, columns - width) };
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

/** Blank rows inserted before each new user or assistant turn. */
const TURN_GAP_ROWS = 2;

/** Blank lines before each new user or assistant turn. */
export function separateTurns(lines: readonly TranscriptSource[]): TranscriptSource[] {
  const out: TranscriptSource[] = [];
  let prev: LogKind | undefined;
  for (const line of lines) {
    if (prev && isTurn(line.kind) && line.kind !== prev) {
      for (let i = 0; i < TURN_GAP_ROWS; i++) {
        out.push({ key: `${line.key}:gap${i}`, kind: "gap", text: "" });
      }
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
  options: PaintOptions = {},
): PaintedRow[] {
  const rows: PaintedRow[] = [];
  for (const line of separateTurns(lines)) {
    rows.push(...paintOne(line, columns, theme, options));
  }
  return rows;
}

/**
 * Reuse rows whose text did not change. Streaming then lays out only the
 * growing reply, not the history above it.
 */
export function createPaintCache(theme: TuiTheme = defaultTheme): {
  paint(
    lines: readonly TranscriptSource[],
    columns: number,
    options?: PaintOptions,
  ): PaintedRow[];
} {
  const cache = new Map<string, { sig: string; rows: PaintedRow[] }>();
  return {
    paint(lines, columns, options = {}) {
      const expanded = options.toolOutputExpanded === true ? "1" : "0";
      const seen = new Set<string>();
      const rows: PaintedRow[] = [];
      for (const line of separateTurns(lines)) {
        seen.add(line.key);
        const sig = `${theme.id}\0${columns}\0${expanded}\0${line.kind}\0${line.streaming === true ? "1" : "0"}\0${line.text}`;
        const cached = cache.get(line.key);
        if (cached?.sig === sig) {
          rows.push(...cached.rows);
          continue;
        }
        const painted = paintOne(line, columns, theme, options);
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

function paintOne(
  line: TranscriptSource,
  columns: number,
  theme: TuiTheme,
  options: PaintOptions = {},
): PaintedRow[] {
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
  const sourceText =
    line.kind === "tool-result" || line.kind === "tool-error"
      ? foldToolOutput(line.text, options.toolOutputExpanded === true)
      : line.text;
  const blocks = renderContent({
    role: roleFor(line.kind),
    text: sourceText,
    streaming: line.streaming === true,
  });
  const rows = paintBlocks(line, blocks, gutter, blank, bodyWidth);
  const fillBackground = Boolean(theme.roles[line.kind]?.background);
  for (const row of rows) fillRowWidth(row, bodyWidth, fillBackground);
  if (!line.streaming) return rows;
  return appendCaret(rows, line, gutter, blank, bodyWidth, fillBackground);
}

/** Pad a row to full width only when a role background needs a solid fill. */
function fillRowWidth(row: PaintedRow, bodyWidth: number, fillBackground: boolean): void {
  if (!fillBackground) {
    row.text = row.gutter + row.body;
    return;
  }
  const used = displayWidth(row.body);
  if (used >= bodyWidth) {
    row.text = row.gutter + row.body;
    return;
  }
  const pad = " ".repeat(bodyWidth - used);
  row.body += pad;
  row.spans.push({ text: pad, tone: "plain", bold: false, italic: false });
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
  // thinking stays raw (not Markdown) like sys chrome.
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
    const painted =
      spans.length > 0
        ? spans
        : [{ text: body, tone: "plain" as const, bold: false, italic: false }];
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
      const fenceLabel = block.lang?.trim() ? `\`\`\`${block.lang.trim()}` : "```";
      push(paintSpans([{ text: fenceLabel, tone: "dim" }], false));
      const rail = "│ ";
      const railWidth = displayWidth(rail);
      const codeWidth = Math.max(1, bodyWidth - railWidth);
      const codeLines = source.length > 0 ? source : [""];
      for (const codeLine of codeLines) {
        for (const wrapped of wrapText(codeLine.length > 0 ? codeLine : " ", codeWidth)) {
          push(
            paintSpans(
              [
                { text: rail, tone: "dim" },
                { text: wrapped || " ", tone: "code" },
              ],
              false,
            ),
          );
        }
      }
      if (block.closed) push(paintSpans([{ text: "```", tone: "dim" }], false));
      continue;
    }
    if (block.kind === "table" && block.cells && block.cells.length > 0) {
      for (const row of paintTable(block.cells, block.aligns, bodyWidth)) {
        push(row);
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

/**
 * Paint a GFM table as aligned columns with a rule under the header.
 * Pipe characters from the source markdown are not shown.
 */
function paintTable(
  cells: readonly RenderSpan[][][],
  aligns: readonly (TableAlign | null)[] | undefined,
  bodyWidth: number,
): PaintedSpan[][] {
  const colCount = Math.max(1, ...cells.map((row) => row.length));
  const widths: number[] = Array.from({ length: colCount }, () => 1);
  for (const row of cells) {
    for (let c = 0; c < colCount; c++) {
      const cell = row[c] ?? [];
      const width = Math.max(1, displayWidth(cell.map((span) => span.text).join("")));
      widths[c] = Math.max(widths[c]!, width);
    }
  }
  // Shrink columns proportionally when the table is wider than the viewport.
  const gap = 2;
  const gaps = Math.max(0, colCount - 1) * gap;
  let total = widths.reduce((sum, width) => sum + width, 0) + gaps;
  if (total > bodyWidth) {
    const budget = Math.max(colCount, bodyWidth - gaps);
    const scale = budget / Math.max(1, total - gaps);
    for (let c = 0; c < colCount; c++) {
      widths[c] = Math.max(1, Math.floor(widths[c]! * scale));
    }
    total = widths.reduce((sum, width) => sum + width, 0) + gaps;
    let extra = bodyWidth - total;
    for (let c = 0; extra < 0 && c < colCount; c++) {
      const cut = Math.min(widths[c]! - 1, -extra);
      widths[c]! -= cut;
      extra += cut;
    }
  }

  const out: PaintedSpan[][] = [];
  cells.forEach((row, rowIndex) => {
    out.push(paintTableRow(row, widths, aligns, gap, rowIndex === 0));
    if (rowIndex === 0) {
      const rule = widths.map((width) => "─".repeat(width)).join(" ".repeat(gap));
      out.push(paintSpans([{ text: rule.slice(0, bodyWidth) || "─", tone: "dim" }], false));
    }
  });
  return out;
}

function paintTableRow(
  row: readonly RenderSpan[][],
  widths: readonly number[],
  aligns: readonly (TableAlign | null)[] | undefined,
  gap: number,
  header: boolean,
): PaintedSpan[] {
  const spans: RenderSpan[] = [];
  for (let c = 0; c < widths.length; c++) {
    if (c > 0) spans.push({ text: " ".repeat(gap), tone: "plain" });
    const width = widths[c]!;
    const cell = row[c] ?? [];
    const text = cell.map((span) => span.text).join("");
    const clipped = clipToWidth(text, width);
    const pad = Math.max(0, width - displayWidth(clipped));
    const align = aligns?.[c] ?? null;
    let left = 0;
    let right = pad;
    if (align === "right") {
      left = pad;
      right = 0;
    } else if (align === "center") {
      left = Math.floor(pad / 2);
      right = pad - left;
    }
    if (left) spans.push({ text: " ".repeat(left), tone: "plain" });
    if (clipped) {
      // Re-parse wasn't needed — restyle the joined text for header bold,
      // keep the first cell span tone when it's a single styled run.
      if (cell.length === 1 && cell[0]!.text === clipped) {
        spans.push({
          text: clipped,
          tone: header && cell[0]!.tone === "plain" ? "strong" : cell[0]!.tone,
        });
      } else if (cell.length === 0) {
        spans.push({ text: clipped || " ".repeat(width), tone: header ? "strong" : "plain" });
      } else {
        // Multi-span cell: emit clipped by walking spans until width is filled.
        let used = 0;
        for (const span of cell) {
          if (used >= displayWidth(clipped)) break;
          const room = displayWidth(clipped) - used;
          const piece = clipToWidth(span.text, room);
          if (!piece) continue;
          spans.push({
            text: piece,
            tone: header && span.tone === "plain" ? "strong" : span.tone,
          });
          used += displayWidth(piece);
        }
        if (used === 0) {
          spans.push({ text: " ".repeat(width), tone: "plain" });
          right = 0;
          left = 0;
        }
      }
    } else {
      spans.push({ text: " ".repeat(width), tone: "plain" });
      right = 0;
    }
    if (right) spans.push({ text: " ".repeat(right), tone: "plain" });
  }
  return paintSpans(spans.length > 0 ? spans : [{ text: " ", tone: "plain" }], header);
}

function clipToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  let out = "";
  for (const ch of text) {
    if (displayWidth(out + ch) > width) break;
    out += ch;
  }
  return out;
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
  fillBackground: boolean,
): PaintedRow[] {
  const caret: PaintedSpan = { text: "▍", tone: "plain", bold: false, italic: false };
  const last = rows[rows.length - 1];
  if (last) {
    // Drop the fill padding so the caret sits after the real text.
    trimFill(last);
    if (displayWidth(last.body) + displayWidth(caret.text) <= bodyWidth) {
      last.spans.push(caret);
      last.body += caret.text;
      fillRowWidth(last, bodyWidth, fillBackground);
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
  fillRowWidth(row, bodyWidth, fillBackground);
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
      italic: span.tone === "em",
    }));
}

function paintQuote(spans: readonly RenderSpan[]): PaintedSpan[] {
  return spans
    .filter((span) => span.text.length > 0)
    .map((span) => ({
      text: span.text,
      tone: span.tone === "code" || span.tone === "link" ? span.tone : "dim",
      bold: span.tone === "strong",
      italic: span.tone === "em",
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
  /** Rotating copy; {@link activityLabel} picks one from the spinner frame. */
  labels: readonly string[];
  /** Spinner frames to hold each label before advancing. */
  labelHold: number;
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

const THINKING_LABELS = [
  "thinking",
  "pondering",
  "reasoning",
  "working it out",
  "considering",
  "figuring it out",
  "weighing options",
  "connecting dots",
] as const;

const WRITING_LABELS = [
  "writing",
  "composing",
  "drafting",
  "replying",
  "shaping the answer",
] as const;

const CONTINUING_LABELS = [
  "following up",
  "picking up the queue",
  "continuing",
  "next note",
] as const;

const APPROVAL_LABELS = [
  "waiting for approval",
  "needs your OK",
  "permission pending",
] as const;

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
    return spec("approval", APPROVAL_LABELS, theme.activity.approval, 220, 5);
  }
  if (input.status !== "running") return null;
  if (input.toolName) {
    const name = clipLabel(input.toolName);
    return spec(
      "tool",
      [`running ${name}`, `using ${name}`, `${name} in progress`],
      theme.activity.tool,
      200,
      5,
    );
  }
  if (input.streaming) {
    return spec("writing", WRITING_LABELS, theme.activity.writing, 200, 6);
  }
  if (input.continuing) {
    return spec("continuing", CONTINUING_LABELS, theme.activity.continuing, 220, 5);
  }
  return spec("thinking", THINKING_LABELS, theme.activity.thinking, 250, 4);
}

export function frameChar(activity: Activity, frame: number): string {
  const frames = activity.frames;
  return frames[frame % frames.length] ?? frames[0] ?? "·";
}

/** Pick the rotating status line for the current spinner frame. */
export function activityLabel(activity: Activity, frame: number): string {
  const hold = Math.max(1, activity.labelHold);
  const labels = activity.labels;
  if (labels.length === 0) return "";
  return labels[Math.floor(frame / hold) % labels.length] ?? labels[0] ?? "";
}

function clipLabel(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= 28) return flat;
  return `${flat.slice(0, 25)}...`;
}

function spec(
  phase: ActivityPhase,
  labels: readonly string[],
  color: string,
  intervalMs: number,
  labelHold: number,
): Activity {
  const frames = FRAMES[phase];
  for (const frame of frames) {
    if (displayWidth(frame) !== 1) {
      throw new Error(`spinner frame ${frame} for ${phase} is not one cell wide`);
    }
  }
  return { phase, labels, labelHold, frames, intervalMs, color };
}
