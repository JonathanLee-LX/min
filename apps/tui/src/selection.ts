import { displayWidth, sliceByColumns } from "./text.js";

/** One cell in the on-screen transcript, in display columns. */
export interface SelCell {
  row: number;
  col: number;
}

export interface SelRange {
  start: SelCell;
  end: SelCell;
}

/**
 * Map a terminal cell onto the transcript. `paddingX` is the Ink frame pad.
 * Coordinates are 0-based.
 */
export function cellFromMouse(
  x: number,
  y: number,
  opts: { paddingX: number; logHeight: number; rowCount: number; rowWidth: number },
): SelCell | null {
  if (opts.rowCount <= 0 || y < 0 || y >= opts.logHeight || y >= opts.rowCount) return null;
  const col = x - opts.paddingX;
  return {
    row: y,
    col: Math.max(0, Math.min(opts.rowWidth, col)),
  };
}

/** Keep a drag on the transcript even if the pointer leaves it. */
export function clampCell(
  x: number,
  y: number,
  opts: { paddingX: number; logHeight: number; rowCount: number; rowWidth: number },
): SelCell | null {
  if (opts.rowCount <= 0) return null;
  const row = Math.max(0, Math.min(opts.rowCount - 1, Math.min(opts.logHeight - 1, y)));
  const col = Math.max(0, Math.min(opts.rowWidth, x - opts.paddingX));
  return { row, col };
}

export function selectionRange(anchor: SelCell, focus: SelCell): SelRange | null {
  if (anchor.row === focus.row && anchor.col === focus.col) return null;
  if (anchor.row < focus.row || (anchor.row === focus.row && anchor.col < focus.col)) {
    return { start: anchor, end: focus };
  }
  return { start: focus, end: anchor };
}

export function rowSelectionCols(
  row: number,
  range: SelRange,
  width: number,
): { start: number; end: number } | null {
  if (row < range.start.row || row > range.end.row) return null;
  const start = row === range.start.row ? range.start.col : 0;
  const end = row === range.end.row ? range.end.col : width;
  if (end <= start) return null;
  return { start, end };
}

export function selectedText(lines: readonly string[], anchor: SelCell, focus: SelCell): string {
  const range = selectionRange(anchor, focus);
  if (!range) return "";
  const out: string[] = [];
  for (let row = range.start.row; row <= range.end.row; row++) {
    const line = lines[row] ?? "";
    const width = Math.max(displayWidth(line), range.end.col);
    const cols = rowSelectionCols(row, range, width);
    if (!cols) continue;
    out.push(sliceByColumns(line, cols.start, cols.end).trimEnd());
  }
  return out.join("\n");
}
