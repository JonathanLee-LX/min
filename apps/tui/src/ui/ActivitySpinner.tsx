import { Text } from "ink";
import { useEffect, useState } from "react";
import { shineText, type Activity } from "../paint.js";
import type { TuiTheme } from "../theme.js";

/** One cell of the highlight per interval. Slower than a typical spinner. */
export const SHINE_MS = 160;

/**
 * One status word with a highlight sliding across it.
 *
 * A timer runs only while `animate` is set. During a token stream the parent
 * passes a rising `pulse` instead, so the shine moves on paints that already
 * happen and does not add a second redraw.
 */
export function ActivitySpinner({
  activity,
  focused,
  animate = true,
  pulse = 0,
}: {
  activity: Activity;
  focused: boolean;
  theme?: TuiTheme;
  /** When false, follow `pulse` instead of a timer. */
  animate?: boolean;
  /** Advances the highlight while the timer is paused. */
  pulse?: number;
}) {
  const live = focused && animate;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setTick((n) => n + 1), SHINE_MS);
    return () => clearInterval(timer);
  }, [live, activity.phase]);

  const frame = focused ? (live ? tick : pulse) : -1;
  const cells = shineText(activity.label, frame);

  return (
    <Text>
      {cells.map((cell, index) => (
        <Text
          key={`${index}:${cell.text}:${cell.hot}`}
          color={cell.hot ? "white" : activity.color}
          bold={cell.hot}
          dimColor={!cell.hot}
        >
          {cell.text}
        </Text>
      ))}
    </Text>
  );
}
