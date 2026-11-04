import { Box, Text } from "ink";
import type { SessionListItem } from "../commands.js";

const VISIBLE = 8;

/**
 * Interactive session picker for `/resume`.
 * Plain Ink Text rows (same dismiss-safe approach as CommandSelect).
 */
export function SessionSelect({
  sessions,
  currentId,
  selectedIndex = 0,
}: {
  sessions: readonly SessionListItem[];
  currentId: string;
  selectedIndex?: number;
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
        const mark = session.id === currentId ? "*" : " ";
        const title = session.title?.trim() ? `  ${session.title.trim()}` : "";
        const label = `${mark} ${session.id}  ${sessionStamp(session.updatedAt)}${title}`;
        return (
          <Box key={session.id} height={1} flexShrink={0}>
            <Text color={focused ? "cyan" : undefined} bold={focused} wrap="truncate">
              {focused ? "› " : "  "}
              {label}
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

function sessionStamp(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso);
  return match ? `${match[1]} ${match[2]}` : iso;
}
