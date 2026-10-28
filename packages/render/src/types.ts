/**
 * Host-agnostic content model for Markdown and plain text.
 * TUI / Web paint `RenderBlock`s; this package only parses.
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
  /** Logical lines. Wrapping to the terminal / viewport width is the host's job. */
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
