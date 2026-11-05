import { composerPaddingRows } from "./ui/Composer.js";
import { displayWidth, wrapText } from "./text.js";

/**
 * Ink 5 IME caret sync + flicker-free paints.
 *
 * Ink's fullscreen path (`outputHeight >= stdout.rows`) writes
 * `clearTerminal` (ED2 + ED3 + CUP home) on every frame. Terminals that
 * honor synchronized output (DEC 2026) — Ghostty, iTerm — show one
 * finished frame. Web terminals often ignore 2026 (or still yank on ED2),
 * so each spinner / stream tick flashes a blank screen.
 *
 * Paint chunks are rewritten to per-row CUP overwrites of *changed*
 * lines, wrapped in DEC 2026 with the cursor hidden, then the caret is
 * parked. A bare resize clear still passes through.
 */

/** Begin synchronized update (DEC mode 2026). Ignored when unsupported. */
export const SYNC_BEGIN = "\x1b[?2026h";
/** End synchronized update. */
export const SYNC_END = "\x1b[?2026l";
/** Hide the cursor so it does not race through the frame. */
export const CURSOR_HIDE = "\x1b[?25l";

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

/**
 * Strip Ink's `clearTerminal` (ED2 + ED3 + home) prefix. Empty body is a
 * resize hard-clear and should still pass through.
 */
export function parseClearTerminalFrame(
  text: string,
): { body: string; hardClear: boolean } | null {
  if (!text.startsWith("\x1b[2J")) return null;
  let index = 4;
  if (text.startsWith("\x1b[3J", index)) index += 4;
  if (text.startsWith("\x1b[H", index)) index += 3;
  else if (text.startsWith("\x1b[1;1H", index)) index += 6;
  const body = text.slice(index);
  return { body, hardClear: body.length === 0 };
}

/** CUP each changed row. `prev === null` writes every row. */
export function diffFrameLines(
  lines: readonly string[],
  prev: readonly string[] | null,
): string {
  let out = "";
  const prevLen = prev?.length ?? 0;
  for (let i = 0; i < lines.length; i++) {
    if (prev && prev[i] === lines[i]) continue;
    out += `\x1b[${i + 1};1H${lines[i]}\x1b[K`;
  }
  for (let i = lines.length; i < prevLen; i++) {
    out += `\x1b[${i + 1};1H\x1b[K`;
  }
  return out;
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

function paintBody(text: string): { body: string; hardClear: boolean } | null {
  const erased = parseEraseLinesFrame(text);
  if (erased) return { body: erased.body, hardClear: false };
  return parseClearTerminalFrame(text);
}

export function hideImeCursor(write: (chunk: string) => void): void {
  write(CURSOR_HIDE);
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

function skipWrite(encoding: unknown, cb: unknown): true {
  if (typeof encoding === "function") {
    (encoding as (err?: Error | null) => void)();
  } else if (typeof cb === "function") {
    (cb as (err?: Error | null) => void)();
  }
  return true;
}

export function installImeCursorHook(
  stdout: NodeJS.WriteStream,
  getAnchor: () => ImeCaretAnchor | null,
  getColumns: () => number,
): () => void {
  if (!stdout.isTTY) return () => {};
  const originalWrite: StdoutWrite = stdout.write.bind(stdout);
  let syncing = false;
  let prevLines: string[] | null = null;
  let lastCursor = "";

  const writeRaw = (chunk: string) => {
    originalWrite(chunk);
  };

  stdout.write = ((chunk: Parameters<StdoutWrite>[0], encoding?: unknown, cb?: unknown) => {
    const text = chunkText(chunk);
    const mode = !syncing && text ? paintModeForChunk(text) : null;
    if (mode) {
      const parsed = paintBody(text);
      const anchor = getAnchor();
      const cursor = anchor ? imeCursorSequence(anchor, getColumns(), "absolute") : "";
      if (parsed?.hardClear) {
        prevLines = null;
        lastCursor = cursor;
        const wrapped = `${SYNC_BEGIN}${CURSOR_HIDE}${text}${cursor}${SYNC_END}`;
        syncing = true;
        try {
          return writeChunk(originalWrite, wrapped, encoding, cb);
        } finally {
          syncing = false;
        }
      }
      if (parsed) {
        const lines = parsed.body.split("\n");
        const bytes = diffFrameLines(lines, prevLines);
        if (bytes === "" && cursor === lastCursor) {
          return skipWrite(encoding, cb);
        }
        prevLines = lines;
        lastCursor = cursor;
        const wrapped = `${SYNC_BEGIN}${CURSOR_HIDE}${bytes}${cursor}${SYNC_END}`;
        syncing = true;
        try {
          return writeChunk(originalWrite, wrapped, encoding, cb);
        } finally {
          syncing = false;
        }
      }
      // Unparsed 2J/2K: still hide the cursor and park inside one 2026 write.
      lastCursor = cursor;
      const wrapped = `${SYNC_BEGIN}${CURSOR_HIDE}${text}${cursor}${SYNC_END}`;
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
