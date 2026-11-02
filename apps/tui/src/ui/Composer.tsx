import { Box, Text } from "ink";
import { nextBound, wrapText } from "../text.js";
import type { TuiTheme } from "../theme.js";

/** Input content is one terminal row by default (grows with wrap / newlines). */
export const COMPOSER_MIN_ROWS = 1;

/**
 * Vertical padding above/below the content, in row units.
 * Terminal cells are whole rows, so {@link composerPaddingRows} floors this
 * (0.5 → 0 extra blank rows; the rules still frame a single content line).
 */
export const COMPOSER_PADDING_Y = 0.5;

/** Whole terminal rows used for vertical padding. */
export function composerPaddingRows(paddingY: number = COMPOSER_PADDING_Y): number {
  return Math.max(0, Math.floor(paddingY));
}

/** @deprecated Prefer {@link composerPaddingRows}. */
export function composerPadTop(
  _naturalRows?: number,
  _minRows?: number,
): number {
  return composerPaddingRows();
}

/**
 * Soft-wrapped content rows only (no padding).
 * Empty draft still yields one blank row so the caret has a home line.
 */
export function composerContentRows(text: string, columns: number): string[] {
  const lines = wrapText(text, Math.max(1, columns));
  return lines.length > 0 ? lines : [""];
}

/** Content rows only (no vertical padding). */
export function composerContentRowCount(text: string, columns: number): number {
  return Math.max(COMPOSER_MIN_ROWS, composerContentRows(text, columns).length);
}

/** Full body rows between the rules: padding + content + padding. */
export function composerBodyRowCount(text: string, columns: number): number {
  return composerPaddingRows() * 2 + composerContentRowCount(text, columns);
}

/** Lines broken down into fragments for inverse cursor rendering. */
export function composerLinesWithCursor(
  text: string,
  cursor: number,
  columns: number,
): Array<{ before: string; caret?: string; after: string }> {
  const clampedCursor = Math.max(0, Math.min(cursor, text.length));
  const width = Math.max(1, columns);
  const logicalLines = text.split("\n");
  const result: Array<{ before: string; caret?: string; after: string }> = [];

  let globalOffset = 0;
  let caretPlaced = false;

  for (let l = 0; l < logicalLines.length; l++) {
    const line = logicalLines[l]!;
    const lineStart = globalOffset;
    const lineEnd = lineStart + line.length;
    const isLastLogical = l === logicalLines.length - 1;
    const wrapped = wrapText(line, width);
    let wrappedOffsetInLine = 0;

    for (let w = 0; w < wrapped.length; w++) {
      const row = wrapped[w]!;
      const rowStart = lineStart + wrappedOffsetInLine;
      const rowEnd = rowStart + row.length;
      const isLastRowOfLine = w === wrapped.length - 1;

      const cursorInRow =
        !caretPlaced &&
        (clampedCursor < rowEnd ||
          (clampedCursor === rowEnd && (isLastRowOfLine || isLastLogical)));

      if (cursorInRow) {
        caretPlaced = true;
        const localIndex = clampedCursor - rowStart;
        const before = row.slice(0, localIndex);
        const end = nextBound(row, localIndex);
        const caret = row.slice(localIndex, end) || " ";
        const after = row.slice(localIndex + caret.length);
        result.push({ before, caret, after });
      } else {
        result.push({ before: row, after: "" });
      }

      wrappedOffsetInLine += row.length;
    }

    globalOffset = lineEnd + 1;
  }

  if (!caretPlaced) {
    if (result.length > 0) {
      const last = result[result.length - 1]!;
      last.caret = " ";
    } else {
      result.push({ before: "", caret: " ", after: "" });
    }
  }

  return result;
}

/**
 * Framed composer: brand rules + one-row content by default.
 * Soft wraps and hard newlines grow the body; paddingY is floored to cells.
 */
export function Composer({
  text,
  cursor,
  columns,
  color,
  borderColor,
}: {
  text: string;
  cursor?: number;
  columns: number;
  color?: string;
  borderColor: string;
  theme?: TuiTheme;
}) {
  const width = Math.max(1, columns);
  const lines: Array<{ before: string; caret?: string; after: string }> =
    cursor !== undefined
      ? composerLinesWithCursor(text, cursor, width)
      : composerContentRows(text, width).map((line) => ({ before: line, after: "" }));
  const rule = "─".repeat(width);
  const pad = composerPaddingRows();

  /**
   * Keys include line content and cursor so that newly inserted spans (e.g. typing
   * Chinese/multibyte characters or the very first character before the caret)
   * mount a fresh Text node with freshly computed Yoga layout width. This avoids
   * an Ink reconciler bug where inserting nodes before an existing child doesn't
   * mark the parent Yoga node dirty, which previously left maxWidth at 1 (the initial
   * caret space width) and clipped Chinese characters into empty output.
   */
  const body = lines.map((line, index) => (
    <Box
      key={`composer:${index}:${line.before}:${line.caret ?? ""}:${line.after}`}
      height={1}
      width={width}
      flexShrink={0}
    >
      {line.caret !== undefined ? (
        <Text key={`composer-text:${line.before}:${line.caret}:${line.after}`}>
          {line.before ? <Text color={color}>{line.before}</Text> : null}
          <Text color={color} inverse>
            {line.caret}
          </Text>
          {line.after ? <Text color={color}>{line.after}</Text> : null}
        </Text>
      ) : (
        <Text key={`composer-text:${line.before}`} color={color}>
          {line.before.length > 0 ? line.before : " "}
        </Text>
      )}
    </Box>
  ));

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Box height={1} width={width} flexShrink={0}>
        <Text color={borderColor} wrap="truncate">
          {rule}
        </Text>
      </Box>
      {pad > 0 ? (
        <Box flexDirection="column" width={width} flexShrink={0} paddingY={pad}>
          {body}
        </Box>
      ) : (
        <Box flexDirection="column" width={width} flexShrink={0}>
          {body}
        </Box>
      )}
      <Box height={1} width={width} flexShrink={0}>
        <Text color={borderColor} wrap="truncate">
          {rule}
        </Text>
      </Box>
    </Box>
  );
}
