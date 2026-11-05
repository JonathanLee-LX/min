/**
 * Coalesce wheel/page ticks so Ink paints at most once per interval.
 * Matches Ink's ~32ms log-update throttle: each `setScroll` is a full
 * Yoga layout, so flushing faster than that just queues hitchy frames.
 */
export const SCROLL_FLUSH_MS = 32;

export function createScrollPump(
  apply: (delta: number) => void,
  flushMs = SCROLL_FLUSH_MS,
): { add(delta: number): void; flush(): void; dispose(): void } {
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const delta = pending;
    pending = 0;
    if (delta) apply(delta);
  };

  return {
    add(delta: number) {
      pending += delta;
      if (timer) return;
      timer = setTimeout(flush, flushMs);
    },
    flush,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = 0;
    },
  };
}
