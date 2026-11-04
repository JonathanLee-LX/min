import type { SessionListItem } from "./commands.js";
import { displayWidth } from "./text.js";

export interface ResumeRow {
  mark: string;
  topic: string;
  meta: string;
}

/**
 * One picker row: the conversation topic first, then turns, local time, and
 * a short id. The topic is clipped so the meta still fits.
 */
export function resumeRowParts(
  session: SessionListItem,
  columns: number,
  current: boolean,
  now = new Date(),
): ResumeRow {
  const mark = current ? "* " : "  ";
  const meta = `  ${resumeMeta(session, now)}`;
  const room = Math.max(4, columns - displayWidth(mark) - displayWidth(meta));
  return {
    mark,
    topic: clipWidth(resumeTopic(session), room),
    meta,
  };
}

export function formatResumeRow(
  session: SessionListItem,
  columns: number,
  current: boolean,
  now = new Date(),
): string {
  const parts = resumeRowParts(session, columns, current, now);
  return `${parts.mark}${parts.topic}${parts.meta}`;
}

function resumeTopic(session: SessionListItem): string {
  const first = collapse(session.preview || session.title || "(untitled)");
  const latest = collapse(session.latest || "");
  if (!latest || latest === first) return first;
  return `${first} → ${latest}`;
}

function resumeMeta(session: SessionListItem, now: Date): string {
  const turns = session.turns;
  const turnLabel =
    turns == null ? "" : turns === 1 ? "1 turn" : `${turns} turns`;
  return [turnLabel, sessionWhen(session.updatedAt, now), shortSessionId(session.id)]
    .filter(Boolean)
    .join(" · ");
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
