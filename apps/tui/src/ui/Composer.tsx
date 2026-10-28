import { Box, Text } from "ink";
import { wrapText } from "../text.js";
import type { TuiTheme } from "../theme.js";

/** Input content is one terminal row by default (grows with wrap / newlines). */
export const COMPOSER_MIN_ROWS = 1;

/** Vertical padding (rows) above and below the content, inside the rules. */
export const COMPOSER_PADDING_Y = 1;

/** @deprecated Prefer {@link COMPOSER_PADDING_Y}; kept for caret helpers. */
export function composerPadTop(
  _naturalRows?: number,
  _minRows?: number,
): number {
  return COMPOSER_PADDING_Y;
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
  return COMPOSER_PADDING_Y * 2 + composerContentRowCount(text, columns);
}

/**
 * Framed composer: brand rules, 1-row content by default, vertical padding
 * for breathing room / centering. Soft wraps and hard newlines grow the body.
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
      <Box
        flexDirection="column"
        width={width}
        flexShrink={0}
        paddingY={COMPOSER_PADDING_Y}
      >
        {lines.map((line, index) => (
          <Box key={`composer:${index}`} height={1} width={width} flexShrink={0}>
            <Text color={color} wrap="truncate">
              {line.length > 0 ? line : " "}
            </Text>
          </Box>
        ))}
      </Box>
      <Box height={1} width={width} flexShrink={0}>
        <Text color={borderColor} wrap="truncate">
          {rule}
        </Text>
      </Box>
    </Box>
  );
}
