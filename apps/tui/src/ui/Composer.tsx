import { Box, Text } from "ink";
import { wrapText } from "../text.js";
import type { TuiTheme } from "../theme.js";

/** Minimum content rows — one logical line at 2× terminal line height. */
export const COMPOSER_MIN_ROWS = 2;

/** Soft-wrapped content rows for the composer (at least {@link COMPOSER_MIN_ROWS}). */
export function composerContentRows(text: string, columns: number): string[] {
  const lines = wrapText(text, Math.max(1, columns));
  while (lines.length < COMPOSER_MIN_ROWS) lines.push("");
  return lines;
}

export function composerContentRowCount(text: string, columns: number): number {
  return composerContentRows(text, columns).length;
}

/**
 * Framed composer: brand top/bottom rules, soft-wrapped body, min 2 rows.
 * Hard newlines (Shift+Enter) and soft wraps both grow the box.
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
