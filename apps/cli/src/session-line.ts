import type { SessionSummary } from "@min-agent/session";

/** One saved session, with the topic before the id so the rows are easy to tell apart. */
export function formatCliSessionLine(meta: SessionSummary, current = false): string {
  const mark = current ? "* " : "  ";
  const topic = meta.title || meta.preview || "(untitled)";
  const latest = meta.latest && meta.latest !== topic ? ` → ${meta.latest}` : "";
  const turns = meta.turns === 1 ? "1 turn" : `${meta.turns} turns`;
  return `${mark}${topic}${latest}  ${turns}  ${meta.updatedAt}  ${meta.id}`;
}
