import { Box, Text } from "ink";
import { layoutModelRows, type ModelListItem } from "../model-brief.js";

const VISIBLE = 8;

/**
 * Interactive model / thinking-effort picker for `/model`.
 * Plain Ink Text rows (same dismiss-safe approach as CommandSelect).
 */
export function ModelSelect({
  items,
  selectedIndex = 0,
  columns = 80,
  hint = "model · ↑↓ select · Enter switch · Esc cancel",
  minRows = 0,
}: {
  items: readonly ModelListItem[];
  selectedIndex?: number;
  /** Width available for one row, including the focus marker. */
  columns?: number;
  hint?: string;
  /** Pad with blank rows so a shorter submenu does not move the composer. */
  minRows?: number;
}) {
  if (items.length === 0) {
    return (
      <Box flexDirection="column" flexShrink={0}>
        <Box height={1} flexShrink={0}>
          <Text dimColor>(no models)</Text>
        </Box>
        {padRows(Math.max(0, minRows - 1))}
      </Box>
    );
  }
  const at = ((selectedIndex % items.length) + items.length) % items.length;
  const { start, end } = modelSelectWindow(items.length, at);
  const visible = items.slice(start, end);
  const rows = layoutModelRows(items, Math.max(20, columns - 2));
  const contentRows = 1 + visible.length;

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box height={1} flexShrink={0}>
        <Text dimColor>{hint}</Text>
      </Box>
      {visible.map((item, index) => {
        const focused = start + index === at;
        const row = rows[start + index]!;
        return (
          <Box key={`${item.name}:${start + index}`} height={1} flexShrink={0}>
            <Text wrap="truncate" color={focused ? "cyan" : undefined} bold={focused}>
              {focused ? "› " : "  "}
              {row.mark}
              {row.name}
              {row.detail ? (
                <Text dimColor={!focused} color={focused ? "cyan" : undefined}>
                  {row.detail}
                </Text>
              ) : null}
            </Text>
          </Box>
        );
      })}
      {padRows(Math.max(0, minRows - contentRows))}
    </Box>
  );
}

function padRows(count: number) {
  if (count <= 0) return null;
  return Array.from({ length: count }, (_, index) => (
    <Box key={`model-pad:${index}`} height={1} flexShrink={0}>
      <Text> </Text>
    </Box>
  ));
}

export function modelSelectRows(count: number): number {
  if (count <= 0) return 1; // empty-state line
  return 1 + Math.min(VISIBLE, count); // hint + rows
}

/** Slice of the full list that keeps `selectedIndex` on screen. */
export function modelSelectWindow(
  count: number,
  selectedIndex: number,
  visible = VISIBLE,
): { start: number; end: number } {
  if (count <= 0) return { start: 0, end: 0 };
  const at = ((selectedIndex % count) + count) % count;
  const size = Math.min(visible, count);
  const start = at < size ? 0 : at - size + 1;
  return { start, end: start + size };
}
