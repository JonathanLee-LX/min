import type { ContextUsage } from "@min-agent/client";
import { Box, Text } from "ink";
import { bottomStatusLines } from "../status-bar.js";
import type { TuiTheme } from "../theme.js";

/**
 * Bottom status bar:
 *   cwd[+branch]
 *   model (thinking)  used/total x%
 */
export function ContextMeter({
  cwd,
  model,
  usage,
  branch,
  dim,
}: {
  cwd: string;
  model: string;
  usage: ContextUsage | undefined;
  branch?: string | null;
  /** Kept for call-site compatibility; status lines are dim text only. */
  theme?: TuiTheme;
  dim: boolean;
}) {
  const lines = bottomStatusLines(cwd, model, usage, branch);
  return (
    <Box flexDirection="column" flexShrink={0}>
      {lines.map((line) => (
        <Text key={line} dimColor={dim} wrap="truncate">
          {line}
        </Text>
      ))}
    </Box>
  );
}

/** Rows reserved under the composer for {@link ContextMeter}. */
export function contextMeterRows(cwd: string, model: string): number {
  if (!cwd.trim() && !model.trim()) return 0;
  return 2;
}
