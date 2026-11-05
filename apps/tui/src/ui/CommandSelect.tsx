import { Box, Text } from "ink";
import { commandColumnWidth, type CommandSpec } from "../commands.js";
import { densityListVisible, type UiDensity } from "../density.js";
import { displayWidth } from "../text.js";

/**
 * Slash-command menu as plain Ink Text rows.
 * Avoid `@inkjs/ui` Select — its unmount left ghost rows under eraseLines.
 * The host owns ↑↓/Enter/Tab while this is mounted.
 */
export function CommandSelect({
  suggestions,
  selectedIndex = 0,
  highlightText,
  density = "comfortable",
}: {
  suggestions: readonly CommandSpec[];
  /** Which match is highlighted (host cycles with ↑↓). */
  selectedIndex?: number;
  /** Typed command prefix without leading slash, for label highlighting. */
  highlightText?: string;
  density?: UiDensity;
}) {
  if (suggestions.length === 0) return null;
  const cap = densityListVisible(density);
  const visible = suggestions.slice(0, cap);
  const selected =
    ((selectedIndex % visible.length) + visible.length) % visible.length;
  const needle = (highlightText ?? "").toLowerCase();
  const labelWidth = commandColumnWidth(visible);

  return (
    <Box flexDirection="column" flexShrink={0}>
      {visible.map((command, index) => {
        const label = `/${command.name}`;
        const labelPad = " ".repeat(Math.max(0, labelWidth - displayWidth(label)));
        const hint = command.hint ? `  ${command.hint}` : "";
        const focused = index === selected;
        const prefixLen =
          needle && command.name.startsWith(needle) ? needle.length + 1 : 0;
        return (
          <Box key={command.name} height={1} flexShrink={0}>
            <Text color={focused ? "cyan" : undefined} bold={focused} wrap="truncate">
              {focused ? "› " : "  "}
              {prefixLen > 0 ? (
                <>
                  <Text bold color={focused ? "cyan" : "white"}>
                    {label.slice(0, prefixLen)}
                  </Text>
                  <Text>{label.slice(prefixLen)}</Text>
                </>
              ) : (
                label
              )}
              {labelPad}
              {hint ? (
                <Text dimColor={!focused} color={focused ? "cyan" : undefined}>
                  {hint}
                </Text>
              ) : null}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function commandSelectRows(
  count: number,
  density: UiDensity = "comfortable",
): number {
  if (count <= 0) return 0;
  return Math.min(densityListVisible(density), count);
}
