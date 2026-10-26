/** Grapheme starts, plus `text.length` as the final bound. */
export function graphemeBounds(text: string): number[] {
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locales?: string,
        options?: { granularity: "grapheme" },
      ) => {
        segment(input: string): Iterable<{ index: number; segment: string }>;
      };
    }
  ).Segmenter;

  if (!Segmenter) {
    const bounds = [0];
    for (const ch of text) {
      bounds.push(bounds[bounds.length - 1]! + ch.length);
    }
    return bounds;
  }

  const bounds = [0];
  for (const part of new Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    const end = part.index + part.segment.length;
    if (bounds[bounds.length - 1] !== end) bounds.push(end);
  }
  if (bounds[bounds.length - 1] !== text.length) bounds.push(text.length);
  return bounds;
}

export function previousBound(text: string, cursor: number): number {
  const bounds = graphemeBounds(text);
  let prev = 0;
  for (const bound of bounds) {
    if (bound >= cursor) return prev;
    prev = bound;
  }
  return prev;
}

export function nextBound(text: string, cursor: number): number {
  for (const bound of graphemeBounds(text)) {
    if (bound > cursor) return bound;
  }
  return text.length;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    width += codePointWidth(cp);
  }
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

/** Split `text` into visual rows of at most `columns` display cells. */
export function wrapText(text: string, columns: number): string[] {
  const width = Math.max(1, columns);
  const rows: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) {
      rows.push("");
      continue;
    }
    let row = "";
    let rowWidth = 0;
    for (const ch of line) {
      const cell = codePointWidth(ch.codePointAt(0) ?? 0);
      if (row && rowWidth + cell > width) {
        rows.push(row);
        row = ch;
        rowWidth = cell;
      } else {
        row += ch;
        rowWidth += cell;
      }
    }
    if (row) rows.push(row);
  }
  return rows.length > 0 ? rows : [""];
}

/** How many terminal rows `text` occupies at `columns`. */
export function wrappedRows(text: string, columns: number): number {
  return wrapText(text, columns).length;
}
