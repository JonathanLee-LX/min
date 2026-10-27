/** Single-line tool bodies shorter than this stay visible when collapsed. */
const SHORT_LINE_MAX = 80;
/** First-line preview width inside a collapsed summary. */
const PREVIEW_MAX = 48;

/**
 * Collapse tool output to a one-line summary by default.
 * Expanded mode returns the original body unchanged.
 */
export function foldToolOutput(text: string, expanded: boolean): string {
  if (expanded) return text;
  const lines = text.split("\n");
  const lineCount = lines.length;
  if (lineCount === 1 && text.length <= SHORT_LINE_MAX) return text;

  const first = lines[0] ?? "";
  const preview =
    first.length > PREVIEW_MAX ? `${first.slice(0, PREVIEW_MAX - 1)}…` : first;
  if (lineCount <= 1) return `${preview}  · Ctrl+O`;
  return `${preview}  · ${lineCount} lines · Ctrl+O`;
}

/** True when folding would change the displayed body. */
export function toolOutputFoldable(text: string): boolean {
  return foldToolOutput(text, false) !== text;
}
