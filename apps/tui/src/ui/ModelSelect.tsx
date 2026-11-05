import { Box, Text } from "ink";
import type { EditorState } from "../editor.js";
import { layoutModelRows, type ModelListItem } from "../model-brief.js";
import { filterPickerItems, modelFilterHaystack } from "../picker-filter.js";
import { PickerFilter } from "./PickerFilter.js";

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
  filter,
  emptyLabel = "(no models)",
}: {
  items: readonly ModelListItem[];
  selectedIndex?: number;
  /** Width available for one row, including the focus marker. */
  columns?: number;
  hint?: string;
  /** Pad with blank rows so a shorter submenu does not move the composer. */
  minRows?: number;
  filter: EditorState;
  emptyLabel?: string;
}) {
  const width = Math.max(1, columns);
  const matches = filterPickerItems(items, filter.text, modelFilterHaystack);
  const vacant = items.length === 0 ? emptyLabel : "(no matches)";
  if (matches.length === 0) {
    const contentRows = 3; // hint + filter + empty
    return (
      <Box flexDirection="column" flexShrink={0}>
        <Box height={1} flexShrink={0}>
          <Text dimColor>{hint}</Text>
        </Box>
        <PickerFilter filter={filter} columns={width} />
        <Box height={1} flexShrink={0}>
          <Text dimColor>{vacant}</Text>
        </Box>
        {padRows(Math.max(0, minRows - contentRows))}
      </Box>
    );
  }
  const at = ((selectedIndex % matches.length) + matches.length) % matches.length;
  const { start, end } = modelSelectWindow(matches.length, at);
  const visible = matches.slice(start, end);
  const rows = layoutModelRows(items, Math.max(20, columns - 2));
  const contentRows = 2 + visible.length; // hint + filter + rows

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box height={1} flexShrink={0}>
        <Text dimColor>{hint}</Text>
      </Box>
      <PickerFilter filter={filter} columns={width} />
      {visible.map((item, index) => {
        const focused = start + index === at;
        const sourceIndex = items.indexOf(item);
        const row = rows[sourceIndex]!;
        return (
          <Box key={`${item.name}:${sourceIndex}`} height={1} flexShrink={0}>
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
  const listRows = count <= 0 ? 1 : Math.min(VISIBLE, count);
  return 2 + listRows; // hint + filter + rows/empty
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
