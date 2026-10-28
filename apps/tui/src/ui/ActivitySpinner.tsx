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
 *
 * Freeze to a static glyph when unfocused, or when `animate` is false
 * (e.g. while assistant text is streaming). Ink redraws the whole frame on
 * every spinner tick; animating during stream paints causes visible flicker.
 */
export function ActivitySpinner({
  activity,
  focused,
  theme,
  animate = true,
}: {
  activity: Activity;
  focused: boolean;
  theme: TuiTheme;
  /** When false, show a static glyph instead of the Ink Spinner. */
  animate?: boolean;
}) {
  const live = focused && animate;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const ms = Math.max(120, activity.intervalMs * activity.labelHold);
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [live, activity.intervalMs, activity.labelHold, activity.phase]);

  const label = activityLabel(activity, tick * activity.labelHold);
  const inkTheme = useMemo(
    () => inkThemeFromTui(theme, activity.color),
    [theme, activity.color],
  );

  if (!live) {
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
