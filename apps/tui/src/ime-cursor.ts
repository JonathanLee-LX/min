import { displayWidth } from "./text.js";

/**
 * Ink 5 hides the real terminal cursor and paints a fake caret. OS IMEs
 * (Chinese / Japanese / Korean) place their candidate window at the *real*
 * cursor, so without syncing it the float lands at the wrong corner.
 *
 * Ink ≥6.7 exposes `useCursor` for this; until we upgrade, park the real
 * cursor on the composer caret after each paint.
 */

export interface ImeCursorScreenPos {
  /** 0-based column in the terminal. */
  x: number;
  /** 0-based row from the top of the Ink frame. */
  y: number;
}

export interface ComposerCaretLayout {
  /** Horizontal padding of the root frame (cells). */
  paddingX: number;
  /** Rows above the composer box (banner, log, margins, …). */
  rowsAboveComposer: number;
  chatBar: string;
  text: string;
  /** UTF-16 caret offset into `text`. */
  cursor: number;
}

/** Screen cell for the composer caret (where IME should anchor). */
export function composerCaretScreenPos(layout: ComposerCaretLayout): ImeCursorScreenPos {
  const cursor = Math.max(0, Math.min(layout.cursor, layout.text.length));
  const before = layout.text.slice(0, cursor);
  const lineIndex = before.length === 0 ? 0 : before.split("\n").length - 1;
  const lineStart = before.lastIndexOf("\n") + 1;
  const columnText = layout.text.slice(lineStart, cursor);
  return {
    x: layout.paddingX + displayWidth(layout.chatBar) + displayWidth(columnText),
    y: layout.rowsAboveComposer + lineIndex,
  };
}

/** Move + show the real cursor. No-op when stdout is not a TTY. */
export function applyImeCursor(
  stdout: NodeJS.WriteStream,
  pos: ImeCursorScreenPos,
  termRows: number,
  termColumns: number,
): void {
  if (!stdout.isTTY) return;
  const row = Math.max(1, Math.min(termRows, pos.y + 1));
  const col = Math.max(1, Math.min(Math.max(1, termColumns), pos.x + 1));
  // Show cursor, then CUP to the caret. IME frameworks query this cell.
  stdout.write(`\x1b[?25h\x1b[${row};${col}H`);
}

export function hideImeCursor(stdout: NodeJS.WriteStream): void {
  if (!stdout.isTTY) return;
  stdout.write("\x1b[?25l");
}
