/**
 * Coalesce assistant deltas into one paint.
 *
 * Ink renders through React's legacy reconciler, so `setState` from a
 * network callback paints before it returns. Doing that on every token
 * holds the stream loop inside layout, and the screen advances at the
 * paint rate instead of the model's rate. A short timer lets the current
 * burst land in the buffer first, then paints once — aligned with Ink's
 * ~32ms throttled log-update so streaming does not thrash the screen.
 */
export interface StreamPump {
  push(chunk: string): void;
  /** Cancel a pending paint and return the buffered text. */
  take(): string;
  reset(): void;
}

/** Coalesce stream paints slightly slower than Ink's 32ms throttle. */
export const STREAM_PUMP_MS = 48;

export function createStreamPump(
  flush: (text: string) => void,
  delayMs = STREAM_PUMP_MS,
): StreamPump {
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    push(chunk) {
      buffer += chunk;
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        flush(buffer);
      }, delayMs);
    },
    take() {
      clearTimer();
      const text = buffer;
      buffer = "";
      return text;
    },
    reset() {
      clearTimer();
      buffer = "";
    },
  };
}
