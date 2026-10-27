import { displayWidth } from "./text.js";

/**
 * Ink 5 hides the real terminal cursor and paints with eraseLines, so the
 * frame is *not* pinned to terminal row 0. Absolute CUP therefore lands in
 * the wrong place for IME candidate windows.
 *
 * After each Ink paint, log-update leaves the real cursor one row below the
 * frame. We climb back up to the composer caret and set the column — then
 * re-apply on every stdout write so we win against Ink's throttled redraw.
 *
 * Ink ≥6.7 `useCursor` is the upstream fix; this is the Ink 5 stand-in.
 */

export interface ImeCaretAnchor {
  /** 0-based column in the terminal. */
  column: number;
  /**
   * Content rows below the caret line inside the Ink frame
   * (composer tail + suggestions + status + footer).
   * Does not include log-update's trailing blank line after the frame.
   */
  rowsBelowCaret: number;
}

export interface ComposerCaretLayout {
  paddingX: number;
  chatBar: string;
  text: string;
  /** UTF-16 caret offset into `text`. */
  cursor: number;
  /** Reserved composer box height in rows. */
  inputRows: number;
  /** Rows rendered under the composer box. */
  rowsBelowComposer: number;
}

/** Anchor for the composer caret relative to the bottom of the Ink frame. */
export function composerCaretAnchor(layout: ComposerCaretLayout): ImeCaretAnchor {
  const cursor = Math.max(0, Math.min(layout.cursor, layout.text.length));
  const before = layout.text.slice(0, cursor);
  const lineIndex = before.length === 0 ? 0 : before.split("\n").length - 1;
  const lineStart = before.lastIndexOf("\n") + 1;
  const columnText = layout.text.slice(lineStart, cursor);
  const inputRows = Math.max(1, layout.inputRows);
  const rowsBelowInComposer = Math.max(0, inputRows - 1 - lineIndex);
  return {
    column: layout.paddingX + displayWidth(layout.chatBar) + displayWidth(columnText),
    rowsBelowCaret: rowsBelowInComposer + Math.max(0, layout.rowsBelowComposer),
  };
}

/**
 * Move + show the real cursor.
 * Call immediately after Ink finishes writing a frame (cursor sits one row
 * below the frame due to log-update's trailing newline).
 */
export function applyImeCursor(
  write: (chunk: string) => void,
  anchor: ImeCaretAnchor,
  termColumns: number,
): void {
  // +1: log-update appends an extra newline under the frame.
  const up = 1 + Math.max(0, anchor.rowsBelowCaret);
  const col = Math.max(1, Math.min(Math.max(1, termColumns), anchor.column + 1));
  write(`\x1b[?25h\x1b[${up}A\x1b[${col}G`);
}

export function hideImeCursor(write: (chunk: string) => void): void {
  write("\x1b[?25l");
}

type StdoutWrite = NodeJS.WriteStream["write"];

function isInkFrameWrite(chunk: unknown): boolean {
  const text =
    typeof chunk === "string"
      ? chunk
      : Buffer.isBuffer(chunk)
        ? chunk.toString("utf8")
        : "";
  // log-update eraseLines uses EL (`\x1b[2K`); full-screen path uses clear.
  return text.includes("\x1b[2K") || text.includes("\x1b[2J");
}

/**
 * Re-park the IME caret after every Ink frame paint (Ink paints are throttled
 * and otherwise clobber a one-shot useLayoutEffect).
 */
export function installImeCursorHook(
  stdout: NodeJS.WriteStream,
  getAnchor: () => ImeCaretAnchor | null,
  getColumns: () => number,
): () => void {
  if (!stdout.isTTY) return () => {};
  const originalWrite: StdoutWrite = stdout.write.bind(stdout);
  let syncing = false;

  const writeRaw = (chunk: string) => {
    originalWrite(chunk);
  };

  stdout.write = ((chunk: Parameters<StdoutWrite>[0], encoding?: unknown, cb?: unknown) => {
    const result =
      typeof encoding === "function"
        ? originalWrite(chunk, encoding as (err?: Error | null) => void)
        : originalWrite(
            chunk,
            encoding as BufferEncoding | undefined,
            cb as ((err?: Error | null) => void) | undefined,
          );
    // Only re-park after an Ink frame paint (eraseLines / clearTerminal).
    // Other stdout writes (focus enable, etc.) must not climb relative rows.
    if (!syncing && isInkFrameWrite(chunk)) {
      const anchor = getAnchor();
      if (anchor) {
        syncing = true;
        try {
          applyImeCursor(writeRaw, anchor, getColumns());
        } finally {
          syncing = false;
        }
      }
    }
    return result;
  }) as StdoutWrite;

  return () => {
    stdout.write = originalWrite;
    hideImeCursor(writeRaw);
  };
}
