import { Box, Text } from "ink";
import type { SessionListItem } from "../commands.js";
import type { EditorState } from "../editor.js";
import { visibleSessions } from "../picker-filter.js";
import { layoutResumeRows } from "../session-brief.js";
import { PickerFilter } from "./PickerFilter.js";

const VISIBLE = 8;

/**
 * Interactive session picker for `/resume`.
 * Plain Ink Text rows (same dismiss-safe approach as CommandSelect).
 */
export function SessionSelect({
  sessions,
  currentId,
  selectedIndex = 0,
  columns = 80,
  filter,
  minRows = 0,
}: {
  sessions: readonly SessionListItem[];
  currentId: string;
  selectedIndex?: number;
  /** Width available for one row, including the focus marker. */
  columns?: number;
  filter: EditorState;
  /** Pad with blank rows so filtering does not move the composer. */
  minRows?: number;
}) {
  const width = Math.max(1, columns);
  const matches = visibleSessions(sessions, filter.text);
  const emptyLabel = sessions.length === 0 ? "(no saved sessions)" : "(no matches)";
  if (matches.length === 0) {
    const contentRows = 3; // hint + filter + empty
    return (
      <Box flexDirection="column" flexShrink={0}>
        <Box height={1} flexShrink={0}>
          <Text dimColor>resume · ↑↓ select · Enter open · Esc cancel</Text>
        </Box>
        <PickerFilter filter={filter} columns={width} />
        <Box height={1} flexShrink={0}>
          <Text dimColor>{emptyLabel}</Text>
        </Box>
        {padRows(Math.max(0, minRows - contentRows))}
      </Box>
    );
  }
  const at = ((selectedIndex % matches.length) + matches.length) % matches.length;
  const { start, end } = sessionSelectWindow(matches.length, at);
  const visible = matches.slice(start, end);
  const rows = layoutResumeRows(sessions, Math.max(20, columns - 2), currentId);
  const rowById = new Map(sessions.map((session, index) => [session.id, rows[index]!]));
  const contentRows = 2 + visible.length; // hint + filter + rows

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box height={1} flexShrink={0}>
        <Text dimColor>resume · ↑↓ select · Enter open · Esc cancel</Text>
      </Box>
      <PickerFilter filter={filter} columns={width} />
      {visible.map((session, index) => {
        const focused = start + index === at;
        const row = rowById.get(session.id)!;
        return (
          <Box key={session.id} height={1} flexShrink={0}>
            <Text wrap="truncate" color={focused ? "cyan" : undefined} bold={focused}>
              {focused ? "› " : "  "}
              {row.mark}
              {row.name}
              {row.detail}
              {row.meta ? (
                <Text dimColor={!focused} color={focused ? "cyan" : undefined}>
                  {row.meta}
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
    <Box key={`session-pad:${index}`} height={1} flexShrink={0}>
      <Text> </Text>
    </Box>
  ));
}

export function sessionSelectRows(count: number): number {
  const listRows = count <= 0 ? 1 : Math.min(VISIBLE, count);
  return 2 + listRows; // hint + filter + rows/empty
}

/** Slice of the full list that keeps `selectedIndex` on screen. */
export function sessionSelectWindow(
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
