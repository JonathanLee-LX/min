import type { SessionListItem } from "./commands.js";
import { displayWidth } from "./text.js";

/** One aligned `/resume` row. Every row in a list shares these column widths. */
export interface ResumeRow {
  mark: string;
  /** Session name, padded to the name column. */
  name: string;
  /** Arrow plus the latest prompt, padded. Empty when no row has a latest prompt. */
  detail: string;
  /** Turn count, local time, and short id, padded so each field starts on the same column. */
  meta: string;
}

interface RawResume {
  mark: string;
  name: string;
  latest: string;
  turns: string;
  when: string;
  id: string;
}

/**
 * Lay out a session list so the name, latest prompt, turn count, time, and
 * id each start at the same column. Text columns shrink to `columns` and
 * keep their width across the whole list, including rows that are off screen.
 */
export function layoutResumeRows(
  sessions: readonly SessionListItem[],
  columns: number,
  currentId: string,
  now = new Date(),
): ResumeRow[] {
  const raws = sessions.map((session) => rawResume(session, session.id === currentId, now));
  const widths = columnWidths(raws, Math.max(1, columns));
  return raws.map((raw) => ({
    mark: raw.mark,
    name: padWidth(clipWidth(raw.name, widths.name), widths.name),
    detail: detailCell(raw.latest, widths.latest),
    meta: metaCell(raw, widths),
  }));
}

export function formatResumeLine(row: ResumeRow): string {
  return `${row.mark}${row.name}${row.detail}${row.meta}`;
}

function rawResume(session: SessionListItem, current: boolean, now: Date): RawResume {
  return {
    mark: current ? "* " : "  ",
    name: sessionName(session),
    latest: sessionLatest(session),
    turns: turnLabel(session.turns),
    when: sessionWhen(session.updatedAt, now),
    id: shortSessionId(session.id),
  };
}

function sessionName(session: SessionListItem): string {
  return collapse(session.title || session.preview || "(untitled)");
}

function sessionLatest(session: SessionListItem): string {
  const latest = collapse(session.latest || "");
  if (!latest || latest === sessionName(session)) return "";
  return latest;
}

function turnLabel(turns: number | undefined): string {
  if (turns == null) return "";
  return turns === 1 ? "1 turn" : `${turns} turns`;
}

function columnWidths(
  raws: readonly RawResume[],
  columns: number,
): { name: number; latest: number; turns: number; when: number; id: number } {
  const nameN = colWidth(raws.map((row) => row.name));
  const latestN = colWidth(raws.map((row) => row.latest));
  const turns = colWidth(raws.map((row) => row.turns));
  const when = colWidth(raws.map((row) => row.when));
  const id = colWidth(raws.map((row) => row.id));
  const metaParts = [turns, when, id].filter((width) => width > 0).length;
  // One gap before every meta field, plus "  → " ahead of the latest column.
  const metaW = turns + when + id + 2 * metaParts;
  const middleFixed = latestN > 0 ? 4 : 0;
  const room = columns - displayWidth(raws[0]?.mark ?? "  ") - middleFixed - metaW;
  const flex = fitFlex(room, nameN, latestN);
  return { name: flex.name, latest: flex.latest, turns, when, id };
}

/**
 * Keep each text column at its natural width when it fits.
 * When it does not, the name stays whole and the latest prompt is clipped.
 */
function fitFlex(
  room: number,
  nameN: number,
  latestN: number,
): { name: number; latest: number } {
  if (latestN <= 0) return { name: Math.min(nameN, Math.max(0, room)), latest: 0 };
  if (room <= 1) return { name: nameN > 0 ? 1 : 0, latest: 1 };
  if (nameN + latestN <= room) return { name: nameN, latest: latestN };
  const minLatest = room >= 12 ? 8 : 1;
  const name = Math.min(nameN, Math.max(1, room - minLatest));
  return { name, latest: Math.max(1, room - name) };
}

function detailCell(latest: string, width: number): string {
  if (width <= 0) return "";
  const arrow = latest ? "→" : " ";
  return `  ${arrow} ${padWidth(clipWidth(latest, width), width)}`;
}

function metaCell(
  raw: RawResume,
  widths: { turns: number; when: number; id: number },
): string {
  const parts: string[] = [];
  if (widths.turns > 0) parts.push(padWidth(raw.turns, widths.turns));
  if (widths.when > 0) parts.push(padWidth(raw.when, widths.when));
  if (widths.id > 0) parts.push(padWidth(raw.id, widths.id));
  if (parts.length === 0) return "";
  return `  ${parts.join("  ")}`;
}

function colWidth(values: readonly string[]): number {
  return values.reduce((max, value) => Math.max(max, displayWidth(value)), 0);
}

export function sessionWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.getFullYear() === now.getFullYear()) return clock;
  return `${date.getFullYear()}-${clock}`;
}

export function shortSessionId(id: string): string {
  if (id.length <= 12) return id;
  return `…${id.slice(-6)}`;
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
