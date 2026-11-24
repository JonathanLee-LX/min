/** Compact duration for run status lines (`12s`, `1m 5s`). */
export function formatRunDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

/**
 * Duration of one tool body.
 * A sub-millisecond run is `<1ms`, never `0s`. Exactly `0` is a call that
 * did not enter the tool (for example a denial) and stays `0ms`.
 */
export function formatToolDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms === 0) return "0ms";
  if (ms < 1) return "<1ms";
  if (ms < 1000) {
    const rounded = Math.round(ms);
    if (rounded <= 0) return "<1ms";
    if (rounded >= 1000) return "1.0s";
    return `${rounded}ms`;
  }
  if (ms < 10_000) {
    const tenths = Math.round(ms / 100) / 10;
    if (tenths >= 10) return `${Math.round(ms / 1000)}s`;
    return `${tenths.toFixed(1)}s`;
  }
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const total = Math.round(ms / 1000);
  const min = Math.floor(total / 60);
  const rem = total % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

export function recordedDuration(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/** Elapsed time while a body is still running. Never `0ms`; that label is a denial. */
export function formatLiveToolDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1) return "<1ms";
  return formatToolDuration(ms);
}

/**
 * Stored duration wins. A live call with no stored value ticks.
 * History with no duration stays blank.
 */
export function toolDurationLabel(input: {
  stored: unknown;
  startedAt?: number;
  now: number;
}): string | undefined {
  const stored = recordedDuration(input.stored);
  if (stored !== undefined) return formatToolDuration(stored);
  if (input.startedAt === undefined) return undefined;
  return formatLiveToolDuration(input.now - input.startedAt);
}
