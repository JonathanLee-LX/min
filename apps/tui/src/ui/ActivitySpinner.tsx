import { Text } from "ink";
import { useEffect, useState } from "react";
import { shineText, type Activity } from "../paint.js";
import type { TuiTheme } from "../theme.js";

/** One step of the highlight. Short enough that the soft edge blends. */
export const SHINE_MS = 80;

function shineProps(
  heat: number,
  color: string,
): { color: string; bold: boolean; dimColor: boolean } {
  if (heat >= 4) return { color: "white", bold: true, dimColor: false };
  if (heat === 3) return { color: "white", bold: false, dimColor: false };
  if (heat === 2) return { color, bold: true, dimColor: false };
  if (heat === 1) return { color, bold: false, dimColor: false };
  return { color, bold: false, dimColor: true };
}

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

  const frame = focused ? (live ? tick : Math.floor(pulse / 4)) : -1;
  const cells = shineText(activity.label, frame);

  return (
    <Text>
      {cells.map((cell, index) => {
        const style = shineProps(cell.heat, activity.color);
        return (
          <Text
            key={index}
            color={style.color}
            bold={style.bold}
            dimColor={style.dimColor}
          >
            {cell.text}
          </Text>
        );
      })}
    </Text>
  );
}
