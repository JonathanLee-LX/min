import { composerPaddingRows } from "./ui/Composer.js";
import { displayWidth, wrapText } from "./text.js";

/**
 * Ink 5 IME caret sync.
 *
 * Normal paints use eraseLines (relative climb from under the frame).
 * A rare clearTerminal / hard-clear write uses absolute CUP from top.
 */

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

export function applyImeCursor(
  write: (chunk: string) => void,
  anchor: ImeCaretAnchor,
  termColumns: number,
  mode: ImePaintMode,
): void {
  const col = Math.max(1, Math.min(Math.max(1, termColumns), anchor.column + 1));
  if (mode === "absolute") {
    const row = Math.max(1, anchor.rowFromTop + 1);
    write(`\x1b[?25h\x1b[${row};${col}H`);
    return;
  }
  // log-update appends an extra newline under the frame.
  const up = 1 + Math.max(0, anchor.rowsBelowCaret);
  write(`\x1b[?25h\x1b[${up}A\x1b[${col}G`);
}

export function hideImeCursor(write: (chunk: string) => void): void {
  write("\x1b[?25l");
}

type StdoutWrite = NodeJS.WriteStream["write"];

function paintModeForChunk(chunk: unknown): ImePaintMode | null {
  const text =
    typeof chunk === "string"
      ? chunk
      : Buffer.isBuffer(chunk)
        ? chunk.toString("utf8")
        : "";
  if (text.includes("\x1b[2J")) return "absolute";
  if (text.includes("\x1b[2K")) return "relative";
  return null;
}

export function installImeCursorHook(
  stdout: NodeJS.WriteStream,
  getAnchor: () => ImeCaretAnchor | null,
  getColumns: () => number,
): () => void {
  if (!stdout.isTTY) return () => {};
  const originalWrite: StdoutWrite = stdout.write.bind(stdout);
  let syncing = false;
  let lastKey = "";

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
    const mode = paintModeForChunk(chunk);
    if (!syncing && mode) {
      const anchor = getAnchor();
      if (anchor) {
        const key = `${mode}:${anchor.rowFromTop}:${anchor.column}:${anchor.rowsBelowCaret}:${getColumns()}`;
        // Skip no-op re-parks — eraseLines frames fire often and re-CUP flickers.
        if (key !== lastKey || mode === "absolute") {
          lastKey = key;
          syncing = true;
          try {
            applyImeCursor(writeRaw, anchor, getColumns(), mode);
          } finally {
            syncing = false;
          }
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
