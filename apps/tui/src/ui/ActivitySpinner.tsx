import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { shineRuns, SIDE_BLOCK_GAP, type Activity } from "../paint.js";
import type { TuiTheme } from "../theme.js";

/**
 * Claude-style glimmer clock: about 12 fps. Fast enough that a 3-cell
 * band overlaps itself, slow enough not to fight stream paints.
 */
export const SHINE_MS = 80;

/** Blank rows above the status word (1X). No pad below. */
export const SPINNER_PAD_Y = SIDE_BLOCK_GAP;

export function activitySpinnerRows(visible: boolean): number {
  return visible ? SPINNER_PAD_Y + 1 : 0;
}

/** Shine step from wall time so stream paints do not jump the highlight. */
export function shineFrame(nowMs: number, intervalMs = SHINE_MS): number {
  return Math.floor(Math.max(0, nowMs) / intervalMs);
}

function parseHex(color: string): [number, number, number] | null {
  const raw = color.startsWith("#") ? color.slice(1) : "";
  if (raw.length !== 6) return null;
  const n = Number.parseInt(raw, 16);
  if (Number.isNaN(n)) return null;
  return [n >> 16, (n >> 8) & 0xff, n & 0xff];
}

/** Mix `base` toward white. Used so the band eases instead of flashing. */
export function shineColor(base: string, heat: number): string {
  if (heat <= 0) return base;
  const rgb = parseHex(base);
  if (!rgb) return heat >= 2 ? "white" : base;
  const t = Math.min(1, heat / 3);
  const mix = rgb.map((channel) => Math.round(channel + (255 - channel) * t));
  return `#${mix.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * One status word with a highlight sliding across it.
 *
 * Matches how Claude Code / similar Ink TUIs do glimmer: a dedicated
 * clock, a band that walks off the word, and a few color spans rather
 * than one Text node per character.
 */
export function ActivitySpinner({
  activity,
  focused,
}: {
  activity: Activity;
  focused: boolean;
  theme?: TuiTheme;
}) {
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!focused) return;
    const timer = setInterval(() => setNow(Date.now()), SHINE_MS);
    return () => clearInterval(timer);
  }, [focused]);

  const frame = focused ? shineFrame(Date.now()) : -1;
  const runs = shineRuns(activity.label, frame);
  const pads = Array.from({ length: SPINNER_PAD_Y }, (_, index) => (
    <Text key={`pad:${index}`}> </Text>
  ));

  return (
    <Box flexDirection="column" flexShrink={0}>
      {pads}
      <Text>
        {runs.map((run, index) => (
          <Text
            key={index}
            color={shineColor(activity.color, run.heat)}
            dimColor={run.heat === 0}
          >
            {run.text}
          </Text>
        ))}
      </Text>
    </Box>
  );
}
