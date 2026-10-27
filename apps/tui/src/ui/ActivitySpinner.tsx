import { Spinner, ThemeProvider } from "@inkjs/ui";
import { Text } from "ink";
import { useEffect, useMemo, useState } from "react";
import { activityLabel, type Activity, type ActivityPhase } from "../paint.js";
import type { TuiTheme } from "../theme.js";
import { inkThemeFromTui } from "./ink-theme.js";

/** cli-spinners names accepted by `@inkjs/ui` Spinner. */
const SPINNER_TYPE: Record<ActivityPhase, "dots" | "line" | "dots12" | "arrow" | "moon"> = {
  thinking: "dots",
  writing: "line",
  tool: "dots12",
  continuing: "arrow",
  approval: "moon",
};

/**
 * Activity chrome built on `@inkjs/ui` Spinner, with min's rotating labels.
 * When the terminal is unfocused we freeze to a static glyph to avoid flicker.
 */
export function ActivitySpinner({
  activity,
  focused,
  theme,
}: {
  activity: Activity;
  focused: boolean;
  theme: TuiTheme;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!focused) return;
    const ms = Math.max(50, activity.intervalMs * activity.labelHold);
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [focused, activity.intervalMs, activity.labelHold, activity.phase]);

  const label = activityLabel(activity, tick * activity.labelHold);
  const inkTheme = useMemo(
    () => inkThemeFromTui(theme, activity.color),
    [theme, activity.color],
  );

  if (!focused) {
    return (
      <Text color={activity.color}>
        · {label}
      </Text>
    );
  }

  return (
    <ThemeProvider theme={inkTheme}>
      <Spinner label={label} type={SPINNER_TYPE[activity.phase]} />
    </ThemeProvider>
  );
}
