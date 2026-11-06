/** A fact inside a stashed body. Labels never include the fact's value. */
export interface ContextOutlineItem {
  kind: "heading" | "key" | "symbol" | "error";
  label: string;
  offset: number;
}

export interface RecallNeed {
  kind: "heading" | "key" | "symbol" | "error" | "text";
  query: string;
}

const PER_KIND = 8;
const LABEL_MAX = 48;
const SELECT_MAX = 1_200;

function cleanLabel(raw: string): string {
  return raw.replace(/[\[\]\n\r·]/g, " ").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
}

/**
 * Scan a stashed body for headings, KEY= names, code symbols, and errors.
 * Key labels are the name only (`TOKEN_SKILL`), never the value.
 */
export function buildOutline(content: string): ContextOutlineItem[] {
  const items: ContextOutlineItem[] = [];
  const counts: Record<ContextOutlineItem["kind"], number> = {
    heading: 0,
    key: 0,
    symbol: 0,
    error: 0,
  };
  const lines = content.split("\n");
  let offset = 0;
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(\S.*)$/.exec(line);
    if (heading?.[2] && counts.heading < PER_KIND) {
      items.push({ kind: "heading", label: cleanLabel(heading[2]), offset });
      counts.heading += 1;
    }
    const keyRe = /([A-Z][A-Z0-9_]{2,40})=/g;
    let keyMatch: RegExpExecArray | null;
    while ((keyMatch = keyRe.exec(line)) && counts.key < PER_KIND) {
      const prev = keyMatch.index === 0 ? "" : line[keyMatch.index - 1] ?? "";
      if (prev && /[A-Za-z0-9_]/.test(prev)) continue;
      items.push({
        kind: "key",
        label: keyMatch[1] ?? "",
        offset: offset + keyMatch.index,
      });
      counts.key += 1;
    }
    const symbol =
      /^(?:export\s+)?(?:async\s+)?(?:def|class|function)\s+([A-Za-z_]\w*)/.exec(line);
    if (symbol?.[1] && counts.symbol < PER_KIND) {
      items.push({ kind: "symbol", label: symbol[1], offset });
      counts.symbol += 1;
    }
    if (
      /^(?:Traceback \(most recent call last\):|.+Error:|.+Exception:)/.test(line) &&
      counts.error < PER_KIND
    ) {
      items.push({ kind: "error", label: cleanLabel(line), offset });
      counts.error += 1;
    }
    offset += line.length + 1;
  }
  return items;
}

export function outlineDigest(entry: {
  charCount: number;
  outline: readonly ContextOutlineItem[];
}): string {
  const parts = [`chars=${entry.charCount}`];
  for (const item of entry.outline.slice(0, 8)) {
    parts.push(`${item.kind}=${item.label}@${item.offset}`);
  }
  const digest = parts.join(" · ");
  return digest.length > 280 ? `${digest.slice(0, 277)}...` : digest;
}

export function formatOutline(items: readonly ContextOutlineItem[]): string {
  if (!items.length) return "(no heading, key, symbol, or error indexed)";
  return items.map((item) => `- ${item.kind} ${item.label} offset=${item.offset}`).join("\n");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineStart(content: string, index: number): number {
  return content.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
}

function lineEnd(content: string, index: number): number {
  const nl = content.indexOf("\n", index);
  return nl === -1 ? content.length : nl + 1;
}

function headingLevel(line: string): number {
  return /^(#{1,6})\s/.exec(line)?.[1]?.length ?? 0;
}

function sectionEnd(content: string, start: number, cap: number): number {
  const firstBreak = content.indexOf("\n", start);
  const firstLine = content.slice(start, firstBreak === -1 ? content.length : firstBreak);
  const level = headingLevel(firstLine) || 1;
  let i = firstBreak === -1 ? content.length : firstBreak + 1;
  while (i < content.length && i < start + cap) {
    const nextBreak = content.indexOf("\n", i);
    const line = content.slice(i, nextBreak === -1 ? content.length : nextBreak);
    const levelAt = headingLevel(line);
    if (levelAt > 0 && levelAt <= level) return i;
    if (nextBreak === -1) return Math.min(content.length, start + cap);
    i = nextBreak + 1;
  }
  return Math.min(content.length, start + cap);
}

function mergeSpans(spans: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ start: span.start, end: span.end });
  }
  return merged;
}

function capSpans(
  spans: { start: number; end: number }[],
  maxChars: number,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let used = 0;
  for (const span of spans) {
    if (used >= maxChars) break;
    const room = maxChars - used;
    const end = Math.min(span.end, span.start + room);
    if (end > span.start) out.push({ start: span.start, end });
    used += end - span.start;
  }
  return out;
}

/**
 * Windows that answer `need`. Empty when nothing matches.
 * Each window is a small neighborhood, not the stashed body.
 */
export function selectSpans(
  content: string,
  items: readonly ContextOutlineItem[],
  need: RecallNeed,
): { start: number; end: number }[] {
  const query = need.query.trim();
  if (!query) return [];
  const spans: { start: number; end: number }[] = [];

  if (need.kind === "key") {
    const name = query.split("=", 1)[0] ?? query;
    const re = new RegExp(`(?:^|[^A-Za-z0-9_])(${escapeRegExp(name)})=`, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) && spans.length < 3) {
      const at = match.index + match[0].length - (name.length + 1);
      const lineStop = lineEnd(content, at);
      spans.push({
        start: Math.max(lineStart(content, at), at - 40),
        end: Math.min(lineStop, at + 160),
      });
    }
  } else if (need.kind === "text") {
    let from = 0;
    while (spans.length < 3) {
      const at = content.indexOf(query, from);
      if (at < 0) break;
      spans.push({
        start: Math.max(0, at - 80),
        end: Math.min(content.length, at + query.length + 80),
      });
      from = at + Math.max(1, query.length);
    }
  } else if (need.kind === "heading" || need.kind === "symbol" || need.kind === "error") {
    const q = query.toLowerCase();
    const hits = items.filter(
      (item) => item.kind === need.kind && item.label.toLowerCase().includes(q),
    );
    for (const hit of hits.slice(0, 2)) {
      const start = lineStart(content, hit.offset);
      const end =
        need.kind === "heading"
          ? sectionEnd(content, start, 800)
          : Math.min(content.length, start + 800);
      spans.push({ start, end });
    }
  }

  return capSpans(mergeSpans(spans), SELECT_MAX);
}
