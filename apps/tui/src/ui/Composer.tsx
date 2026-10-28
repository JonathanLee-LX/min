import { Box, Text } from "ink";
import { wrapText } from "../text.js";
import type { TuiTheme } from "../theme.js";

/** Minimum content rows — one logical line at 2× terminal line height. */
export const COMPOSER_MIN_ROWS = 2;

/**
 * Soft-wrapped content rows for the composer.
 * Always at least {@link COMPOSER_MIN_ROWS} so an empty / single-line draft
 * keeps a 2× line-height box; hard newlines and soft wraps grow beyond that.
 */
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
 * Enter inserts a newline; soft wraps also grow the box.
 */
export function Composer({
  text,
  columns,
  color,
  borderColor,
  hint,
}: {
  text: string;
  columns: number;
  color?: string;
  borderColor: string;
  /** Dim placeholder shown on the spare row while the draft is empty. */
  hint?: string;
  theme?: TuiTheme;
}) {
  const width = Math.max(1, columns);
  const lines = composerContentRows(text, width);
  const rule = "─".repeat(width);
  const empty = text.length === 0;

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Box height={1} width={width} flexShrink={0}>
        <Text color={borderColor} wrap="truncate">
          {rule}
        </Text>
      </Box>
      {lines.map((line, index) => {
        const showHint = empty && index === 1 && Boolean(hint);
        return (
          <Box key={`composer:${index}`} height={1} width={width} flexShrink={0}>
            <Text
              color={showHint ? borderColor : color}
              dimColor={showHint}
              wrap="truncate"
            >
              {showHint ? hint! : line.length > 0 ? line : " "}
            </Text>
          </Box>
        );
      })}
      <Box height={1} width={width} flexShrink={0}>
        <Text color={borderColor} wrap="truncate">
          {rule}
        </Text>
      </Box>
    </Box>
  );
}
