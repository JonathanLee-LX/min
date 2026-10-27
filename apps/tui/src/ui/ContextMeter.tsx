import { ProgressBar, ThemeProvider } from "@inkjs/ui";
import type { ContextUsage } from "@min-agent/client";
import { Box, Text } from "ink";
import { useMemo } from "react";
import { contextStatusLine } from "../context-view.js";
import type { TuiTheme } from "../theme.js";
import { inkThemeFromTui } from "./ink-theme.js";

/** Model id + short context total, with an `@inkjs/ui` progress bar. */
export function ContextMeter({
  model,
  usage,
  theme,
  dim,
}: {
  model: string;
  usage: ContextUsage | undefined;
  theme: TuiTheme;
  dim: boolean;
}) {
  const inkTheme = useMemo(() => inkThemeFromTui(theme), [theme]);
  const short = contextStatusLine(usage);
  const head = [model.trim(), short].filter((part) => part.length > 0).join(" · ");
  if (!head && !usage) return null;
  const value = usage ? Math.max(0, Math.min(100, Math.round(usage.ratio * 100))) : 0;

  return (
    <ThemeProvider theme={inkTheme}>
      <Box flexDirection="column" flexShrink={0}>
        {head ? (
          <Text dimColor={dim} wrap="truncate">
            {head}
          </Text>
        ) : null}
        {usage ? <ProgressBar value={value} /> : null}
      </Box>
    </ThemeProvider>
  );
}

/** Rows reserved under the composer for {@link ContextMeter}. */
export function contextMeterRows(model: string, usage: ContextUsage | undefined): number {
  const hasHead = model.trim().length > 0 || Boolean(usage);
  if (!hasHead) return 0;
  return usage ? 2 : 1;
}
