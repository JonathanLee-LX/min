import { Box, Text } from "ink";
import type { SessionListItem } from "../commands.js";
import { resumeRowParts } from "../session-brief.js";

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
}: {
  sessions: readonly SessionListItem[];
  currentId: string;
  selectedIndex?: number;
  /** Width available for one row, including the focus marker. */
  columns?: number;
}) {
  if (sessions.length === 0) {
    return (
      <Box height={1} flexShrink={0}>
        <Text dimColor>(no saved sessions)</Text>
      </Box>
    );
  }
  const at = ((selectedIndex % sessions.length) + sessions.length) % sessions.length;
  const { start, end } = sessionSelectWindow(sessions.length, at);
  const visible = sessions.slice(start, end);

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box height={1} flexShrink={0}>
        <Text dimColor>resume · ↑↓ select · Enter open · Esc cancel</Text>
      </Box>
      {visible.map((session, index) => {
        const focused = start + index === at;
        const row = resumeRowParts(session, Math.max(20, columns - 2), session.id === currentId);
        return (
          <Box key={session.id} height={1} flexShrink={0}>
            <Text wrap="truncate" color={focused ? "cyan" : undefined} bold={focused}>
              {focused ? "› " : "  "}
              {row.mark}
              {row.topic}
              <Text dimColor={!focused} color={focused ? "cyan" : undefined}>
                {row.meta}
              </Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function sessionSelectRows(count: number): number {
  if (count <= 0) return 1; // empty-state line
  return 1 + Math.min(VISIBLE, count); // hint + rows
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
