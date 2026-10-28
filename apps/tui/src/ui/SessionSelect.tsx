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
  const visible = sessions.slice(0, VISIBLE);
  const selected =
    ((selectedIndex % visible.length) + visible.length) % visible.length;

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box height={1} flexShrink={0}>
        <Text dimColor>resume · ↑↓ select · Enter open · Esc cancel</Text>
      </Box>
      {visible.map((session, index) => {
        const focused = index === selected;
        const mark = session.id === currentId ? "*" : " ";
        const title = session.title?.trim() ? `  ${session.title.trim()}` : "";
        const label = `${mark} ${session.id}  ${session.updatedAt}${title}`;
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
