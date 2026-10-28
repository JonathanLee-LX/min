import { Box, Text } from "ink";
import { wrapText } from "../text.js";
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

/**
 * Framed composer: brand rules + one-row content by default.
 * Soft wraps and hard newlines grow the body; paddingY is floored to cells.
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
  const pad = composerPaddingRows();

  const body = lines.map((line, index) => (
    <Box key={`composer:${index}`} height={1} width={width} flexShrink={0}>
      <Text color={color} wrap="truncate">
        {line.length > 0 ? line : " "}
      </Text>
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
