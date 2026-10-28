import { Box, Text } from "ink";
import { wrapText } from "../text.js";
import type { TuiTheme } from "../theme.js";

/**
 * Minimum content rows for a single-line draft.
 * Three rows let one line of text sit on the middle row with equal blank
 * padding above and below — true vertical centering between the rules.
 * (Two rows can only flush top or bottom; neither reads as centered.)
 */
export const COMPOSER_MIN_ROWS = 3;

/**
 * Top padding so a short draft sits vertically centered in the min-height box.
 * `floor` keeps leftover rows on the bottom when the free space is odd.
 */
export function composerPadTop(
  naturalRows: number,
  minRows: number = COMPOSER_MIN_ROWS,
): number {
  if (naturalRows >= minRows) return 0;
  return Math.floor((minRows - naturalRows) / 2);
}

/**
 * Soft-wrapped content rows for the composer.
 * Always at least {@link COMPOSER_MIN_ROWS}; hard newlines and soft wraps
 * grow beyond that. Short drafts are padded so text/caret are centered.
 */
export function composerContentRows(text: string, columns: number): string[] {
  const natural = wrapText(text, Math.max(1, columns));
  const padTop = composerPadTop(natural.length);
  const lines = [...Array<string>(padTop).fill(""), ...natural];
  while (lines.length < COMPOSER_MIN_ROWS) lines.push("");
  return lines;
}

export function composerContentRowCount(text: string, columns: number): number {
  return composerContentRows(text, columns).length;
}

/**
 * Framed composer: brand top/bottom rules, soft-wrapped body, min 3 rows.
 * Soft wraps and hard newlines grow the box; no keybinding chrome inside.
 */
export function Composer({
  text,
  columns,
  color,
  borderColor,
}: {
  text: string;
  columns: number;
  color?: string;
  borderColor: string;
  theme?: TuiTheme;
}) {
  const width = Math.max(1, columns);
  const lines = composerContentRows(text, width);
  const rule = "─".repeat(width);

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Box height={1} width={width} flexShrink={0}>
        <Text color={borderColor} wrap="truncate">
          {rule}
        </Text>
      </Box>
      {lines.map((line, index) => (
        <Box key={`composer:${index}`} height={1} width={width} flexShrink={0}>
          <Text color={color} wrap="truncate">
            {line.length > 0 ? line : " "}
          </Text>
        </Box>
      ))}
      <Box height={1} width={width} flexShrink={0}>
        <Text color={borderColor} wrap="truncate">
          {rule}
        </Text>
      </Box>
    </Box>
  );
}
