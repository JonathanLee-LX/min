/**
 * Coalesce assistant deltas into one paint.
 *
 * Ink renders through React's legacy reconciler, so `setState` from a
 * network callback paints before it returns. Doing that on every token
 * holds the stream loop inside layout, and the screen advances at the
 * paint rate instead of the model's rate. A timer lets the current burst
 * land in the buffer first, then paints once.
 */
export interface StreamPump {
  push(chunk: string): void;
  /** Cancel a pending paint and return the buffered text. */
  take(): string;
  reset(): void;
}

export function createStreamPump(flush: (text: string) => void): StreamPump {
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
      }, 0);
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
