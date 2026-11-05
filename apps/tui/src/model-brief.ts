import { displayWidth } from "./text.js";

/** One aligned `/model` (or effort submenu) row. Every row shares these widths. */
export interface ModelRow {
  mark: string;
  /** Model id, saved name, or effort level, padded to the name column. */
  name: string;
  /** Secondary field: thinking marker, provider, or effort hint. */
  detail: string;
}

export interface ModelListItem {
  name: string;
  detail?: string;
  current?: boolean;
}

/**
 * Lay out a model/effort list so the name and detail each start at the same
 * column. Widths come from the whole list, including rows that are off screen.
 */
export function layoutModelRows(
  items: readonly ModelListItem[],
  columns: number,
): ModelRow[] {
  const raws = items.map((item) => ({
    mark: item.current ? "* " : "  ",
    name: collapse(item.name),
    detail: collapse(item.detail ?? ""),
  }));
  const widths = columnWidths(raws, Math.max(1, columns));
  return raws.map((raw) => ({
    mark: raw.mark,
    name: padWidth(clipWidth(raw.name, widths.name), widths.name),
    detail: detailCell(raw.detail, widths.detail),
  }));
}

export function formatModelLine(row: ModelRow): string {
  return `${row.mark}${row.name}${row.detail}`;
}

function columnWidths(
  raws: readonly { mark: string; name: string; detail: string }[],
  columns: number,
): { name: number; detail: number } {
  const nameN = colWidth(raws.map((row) => row.name));
  const detailN = colWidth(raws.map((row) => row.detail));
  const markW = displayWidth(raws[0]?.mark ?? "  ");
  const detailGap = detailN > 0 ? 2 : 0;
  const room = columns - markW - detailGap;
  if (detailN <= 0) return { name: Math.min(nameN, Math.max(0, room)), detail: 0 };
  if (nameN + detailN <= room) return { name: nameN, detail: detailN };
  const minDetail = room >= 12 ? 8 : 1;
  const name = Math.min(nameN, Math.max(1, room - minDetail));
  return { name, detail: Math.max(1, room - name) };
}

function detailCell(detail: string, width: number): string {
  if (width <= 0) return "";
  return `  ${padWidth(clipWidth(detail, width), width)}`;
}

function colWidth(values: readonly string[]): number {
  return values.reduce((max, value) => Math.max(max, displayWidth(value)), 0);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clipWidth(text: string, width: number): string {
  if (width <= 0) return "";
  if (displayWidth(text) <= width) return text;
  if (width === 1) return "…";
  let out = "";
  for (const ch of text) {
    if (displayWidth(out + ch + "…") > width) break;
    out += ch;
  }
  return `${out}…`;
}

function padWidth(text: string, width: number): string {
  const gap = width - displayWidth(text);
  if (gap <= 0) return text;
  return text + " ".repeat(gap);
}
