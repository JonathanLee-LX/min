import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { SIDE_BLOCK_GAP, shineText, type Activity } from "../paint.js";
import type { TuiTheme } from "../theme.js";

/** One step of the highlight. Slow enough to read, still overlaps the last step. */
export const SHINE_MS = 160;

/** Top and bottom blank rows around the status word (1X). */
export const SPINNER_PAD_Y = SIDE_BLOCK_GAP;

export function activitySpinnerRows(visible: boolean): number {
  return visible ? SPINNER_PAD_Y * 2 + 1 : 0;
}

/** Shine step from wall time so stream paints do not jump the highlight. */
export function shineFrame(nowMs: number, intervalMs = SHINE_MS): number {
  return Math.floor(Math.max(0, nowMs) / intervalMs);
}

function shineProps(
  heat: number,
  color: string,
): { color: string; bold: boolean; dimColor: boolean } {
  if (heat >= 3) return { color: "white", bold: true, dimColor: false };
  if (heat === 2) return { color: "white", bold: false, dimColor: false };
  if (heat === 1) return { color, bold: false, dimColor: false };
  return { color, bold: false, dimColor: true };
}

/**
 * One status word with a highlight sliding across it.
 *
 * Position comes from wall time, not token count. A timer runs only while
 * `animate` is set. During a token stream the parent already paints, so the
 * same clock is sampled then and the highlight does not jump.
 */
export function ActivitySpinner({
  activity,
  focused,
  animate = true,
}: {
  activity: Activity;
  focused: boolean;
  theme?: TuiTheme;
  /** When false, do not schedule extra paints; sample time on the parent paint. */
  animate?: boolean;
}) {
  const live = focused && animate;
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), SHINE_MS);
    return () => clearInterval(timer);
  }, [live]);

  const frame = focused ? shineFrame(Date.now()) : -1;
  const cells = shineText(activity.label, frame);
  const pads = Array.from({ length: SPINNER_PAD_Y }, (_, index) => (
    <Text key={`pad:${index}`}> </Text>
  ));

  return (
    <Box flexDirection="column" flexShrink={0}>
      {pads}
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
      {pads}
    </Box>
  );
}
