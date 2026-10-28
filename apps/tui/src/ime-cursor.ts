import { composerPaddingRows } from "./ui/Composer.js";
import { displayWidth, wrapText } from "./text.js";

/**
 * Ink 5 IME caret sync.
 *
 * log-update wipes the frame with eraseLines and then redraws it. Terminals
 * paint that wipe immediately, so every stream or spinner tick flashes.
 * Paint chunks are rewritten to in-place row updates and wrapped in a
 * synchronized output (DEC 2026) together with the caret park, so the
 * terminal shows one finished frame.
 *
 * Normal paints use eraseLines (relative climb from under the frame).
 * A rare clearTerminal / hard-clear write uses absolute CUP from top.
 */

/** Begin synchronized update (DEC mode 2026). Ignored when unsupported. */
export const SYNC_BEGIN = "\x1b[?2026h";
/** End synchronized update. */
export const SYNC_END = "\x1b[?2026l";

export interface ImeCaretAnchor {
  /** 0-based column in the terminal. */
  column: number;
  /** 0-based row from the top of the Ink frame. */
  rowFromTop: number;
  /**
   * Content rows below the caret line inside the Ink frame.
   * Used for the eraseLines (relative) paint path.
   */
  rowsBelowCaret: number;
}

export interface ComposerCaretLayout {
  paddingX: number;
  chatBar: string;
  text: string;
  cursor: number;
  /** Soft-wrap width for the composer text area. */
  columns: number;
  inputRows: number;
  rowsAboveComposer: number;
  rowsBelowComposer: number;
}

export function composerCaretAnchor(layout: ComposerCaretLayout): ImeCaretAnchor {
  const cursor = Math.max(0, Math.min(layout.cursor, layout.text.length));
  const columns = Math.max(1, layout.columns);
  const before = layout.text.slice(0, cursor);
  const visual = wrapText(before, columns);
  const lineIndex = Math.max(0, visual.length - 1);
  const columnText = visual[lineIndex] ?? "";
  // inputRows is the full body (paddingY + content + paddingY).
  const inputRows = Math.max(1, layout.inputRows);
  const padTop = composerPaddingRows();
  const caretRow = padTop + lineIndex;
  const rowsBelowInComposer = Math.max(0, inputRows - 1 - caretRow);
  return {
    column: layout.paddingX + displayWidth(layout.chatBar) + displayWidth(columnText),
    rowFromTop: Math.max(0, layout.rowsAboveComposer) + caretRow,
    rowsBelowCaret: rowsBelowInComposer + Math.max(0, layout.rowsBelowComposer),
  };
}

export type ImePaintMode = "absolute" | "relative";

export function imeCursorSequence(
  anchor: ImeCaretAnchor,
  termColumns: number,
  mode: ImePaintMode,
): string {
  const col = Math.max(1, Math.min(Math.max(1, termColumns), anchor.column + 1));
  if (mode === "absolute") {
    const row = Math.max(1, anchor.rowFromTop + 1);
    return `\x1b[?25h\x1b[${row};${col}H`;
  }
  // log-update appends an extra newline under the frame.
  const up = 1 + Math.max(0, anchor.rowsBelowCaret);
  return `\x1b[?25h\x1b[${up}A\x1b[${col}G`;
}

export function applyImeCursor(
  write: (chunk: string) => void,
  anchor: ImeCaretAnchor,
  termColumns: number,
  mode: ImePaintMode,
): void {
  write(imeCursorSequence(anchor, termColumns, mode));
}

/**
 * Replace an ansi-escapes `eraseLines` prefix with per-row overwrites.
 * Cursor ends on the same trailing row log-update leaves behind, so the
 * relative caret climb still applies. Returns null when `text` is not an
 * eraseLines frame (for example a clearTerminal write).
 */
export function rewriteEraseLinesFrame(text: string): string | null {
  const parsed = parseEraseLinesFrame(text);
  if (!parsed) return null;
  return inPlaceFrame(parsed.linesCleared, parsed.body);
}

function parseEraseLinesFrame(text: string): { linesCleared: number; body: string } | null {
  if (!text.startsWith("\x1b[2K")) return null;
  let index = 0;
  let count = 0;
  while (text.startsWith("\x1b[2K", index)) {
    index += 4;
    count += 1;
    if (text.startsWith("\x1b[1A", index)) index += 4;
    else break;
  }
  if (count === 0 || !text.startsWith("\x1b[G", index)) return null;
  return { linesCleared: count, body: text.slice(index + 3) };
}

function inPlaceFrame(linesCleared: number, body: string): string {
  const parts = body.split("\n");
  const up = Math.max(0, linesCleared - 1);
  let out = up > 0 ? `\x1b[${up}A` : "";
  out += "\x1b[G";
  for (let i = 0; i < parts.length; i++) {
    out += `${parts[i]}\x1b[K`;
    if (i < parts.length - 1) out += "\n";
  }
  const extra = linesCleared - parts.length;
  if (extra > 0) {
    for (let i = 0; i < extra; i++) out += "\n\x1b[K";
    out += `\x1b[${extra}A`;
  }
  return out;
}

export function hideImeCursor(write: (chunk: string) => void): void {
  write("\x1b[?25l");
}

type StdoutWrite = NodeJS.WriteStream["write"];

function chunkText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
  return "";
}

function paintModeForChunk(chunk: unknown): ImePaintMode | null {
  const text = chunkText(chunk);
  if (text.includes("\x1b[2J")) return "absolute";
  if (text.includes("\x1b[2K")) return "relative";
  return null;
}

function writeChunk(
  write: StdoutWrite,
  chunk: Parameters<StdoutWrite>[0],
  encoding: unknown,
  cb: unknown,
): ReturnType<StdoutWrite> {
  if (typeof encoding === "function") {
    return write(chunk, encoding as (err?: Error | null) => void);
  }
  return write(
    chunk,
    encoding as BufferEncoding | undefined,
    cb as ((err?: Error | null) => void) | undefined,
  );
}

export function installImeCursorHook(
  stdout: NodeJS.WriteStream,
  getAnchor: () => ImeCaretAnchor | null,
  getColumns: () => number,
): () => void {
  if (!stdout.isTTY) return () => {};
  const originalWrite: StdoutWrite = stdout.write.bind(stdout);
  let syncing = false;
  // After a park the real cursor sits in the composer. The next eraseLines
  // frame expects it on the trailing row under the frame; move it back first.
  let returnDown = 0;

  const writeRaw = (chunk: string) => {
    originalWrite(chunk);
  };

  stdout.write = ((chunk: Parameters<StdoutWrite>[0], encoding?: unknown, cb?: unknown) => {
    const text = chunkText(chunk);
    const mode = !syncing && text ? paintModeForChunk(text) : null;
    // One write: in-place rows (no blanking wipe) + caret, inside DEC 2026.
    // A second write after eraseLines let the terminal paint the cursor under
    // the frame, and skipping unchanged anchors left it there after Enter.
    if (mode) {
      const anchor = getAnchor();
      const back =
        mode === "relative" && returnDown > 0 ? `\x1b[${returnDown}B` : "";
      const stable =
        mode === "relative" ? (rewriteEraseLinesFrame(text) ?? text) : text;
      const cursor = anchor ? imeCursorSequence(anchor, getColumns(), mode) : "";
      returnDown = anchor ? 1 + Math.max(0, anchor.rowsBelowCaret) : 0;
      const wrapped = `${SYNC_BEGIN}${back}${stable}${cursor}${SYNC_END}`;
      syncing = true;
      try {
        return writeChunk(originalWrite, wrapped, encoding, cb);
      } finally {
        syncing = false;
      }
    }
    return writeChunk(originalWrite, chunk, encoding, cb);
  }) as StdoutWrite;

  return () => {
    stdout.write = originalWrite;
    hideImeCursor(writeRaw);
  };
}
