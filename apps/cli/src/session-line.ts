import type { SessionSummary } from "@min-agent/session";

const NAME_CAP = 40;
const LATEST_CAP = 40;

/**
 * Saved sessions as aligned columns: name, latest prompt, turns, time, and id.
 * Widths come from the whole list, so a short name does not pull the later columns left.
 */
export function formatCliSessionLines(
  metas: readonly SessionSummary[],
  currentId?: string,
): string[] {
  const raws = metas.map((meta) => rawLine(meta, meta.id === currentId));
  const nameW = Math.min(NAME_CAP, colWidth(raws.map((row) => row.name)));
  const latestW = Math.min(LATEST_CAP, colWidth(raws.map((row) => row.latest)));
  const turnsW = colWidth(raws.map((row) => row.turns));
  const whenW = colWidth(raws.map((row) => row.when));
  return raws.map((row) => {
    const name = padWidth(clipWidth(row.name, nameW), nameW);
    const latest = latestW > 0 ? `  ${row.latest ? "→" : " "} ${padWidth(clipWidth(row.latest, latestW), latestW)}` : "";
    const turns = padWidth(row.turns, turnsW);
    const when = padWidth(row.when, whenW);
    return `${row.mark}${name}${latest}  ${turns}  ${when}  ${row.id}`;
  });
}

function rawLine(meta: SessionSummary, current: boolean) {
  const name = collapse(meta.title || meta.preview || "(untitled)");
  const latestText = collapse(meta.latest || "");
  return {
    mark: current ? "* " : "  ",
    name,
    latest: latestText && latestText !== name ? latestText : "",
    turns: meta.turns === 1 ? "1 turn" : `${meta.turns} turns`,
    when: meta.updatedAt,
    id: meta.id,
  };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function colWidth(values: readonly string[]): number {
  return values.reduce((max, value) => Math.max(max, displayWidth(value)), 0);
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

/** Terminal cells. Wide characters, including CJK, count as 2. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += codePointWidth(ch.codePointAt(0) ?? 0);
  return width;
}

function codePointWidth(cp: number): number {
  if (cp === 0 || cp === 0x200d) return 0;
  if (cp >= 0x300 && cp <= 0x36f) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff)
  ) {
    return 2;
  }
  return 1;
}
