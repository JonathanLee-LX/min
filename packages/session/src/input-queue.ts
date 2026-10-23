/**
 * Single-user follow-up queue for interjections during a run.
 *
 * - `enqueue` (default): each push is kept; drain yields every item.
 * - `dense-latest`: rapid supplements replace the pending bubble (best = newest).
 * - `dense-concat`: rapid supplements merge into one bubble (best = combined).
 *
 * Injection happens at Runner turn boundaries (not mid-completion).
 */

export type InputQueueMode = "enqueue" | "dense-latest" | "dense-concat";

export interface InputQueuePushOptions {
  /**
   * Override queue mode for this push only.
   * Use `dense-latest` / `dense-concat` for rapid “补充信息”.
   */
  mode?: InputQueueMode;
}

export interface InputQueueOptions {
  /** Default push policy. */
  mode?: InputQueueMode;
  /**
   * When > 0, pushes within this window (ms) after the previous push
   * are treated as dense supplements (use denseModeBelow).
   */
  denseWindowMs?: number;
  /** Mode applied to pushes inside denseWindowMs. Default dense-latest. */
  denseMode?: "dense-latest" | "dense-concat";
}

export interface InputQueue {
  readonly mode: InputQueueMode;
  readonly size: number;
  push(text: string, opts?: InputQueuePushOptions): void;
  /** Copy of pending texts (not coalesced beyond what's already stored). */
  peek(): readonly string[];
  /** Take pending texts for injection as user messages; clears the queue. */
  drain(): string[];
  clear(): void;
}

export function createInputQueue(
  opts: InputQueueOptions = {},
): InputQueue {
  const defaultMode: InputQueueMode = opts.mode ?? "enqueue";
  const denseWindowMs = opts.denseWindowMs ?? 0;
  const denseMode = opts.denseMode ?? "dense-latest";

  let items: string[] = [];
  let lastPushAt = 0;

  const resolveMode = (override?: InputQueueMode): InputQueueMode => {
    if (override) return override;
    if (denseWindowMs > 0 && lastPushAt > 0) {
      const dt = Date.now() - lastPushAt;
      if (dt <= denseWindowMs) return denseMode;
    }
    return defaultMode;
  };

  return {
    get mode() {
      return defaultMode;
    },
    get size() {
      return items.length;
    },
    peek() {
      return items.slice();
    },
    clear() {
      items = [];
    },
    push(text, pushOpts) {
      const trimmed = text.trim();
      if (!trimmed) return;

      const mode = resolveMode(pushOpts?.mode);
      lastPushAt = Date.now();

      if (mode === "dense-latest") {
        items = [trimmed];
        return;
      }
      if (mode === "dense-concat") {
        if (!items.length) {
          items = [trimmed];
        } else {
          const last = items.length - 1;
          items[last] = `${items[last]}\n${trimmed}`;
        }
        return;
      }
      // enqueue
      items.push(trimmed);
    },
    drain() {
      const out = items;
      items = [];
      return out;
    },
  };
}

/** Join drained queue items into a single user turn (optional host helper). */
export function joinIncoming(
  parts: string[],
  sep = "\n\n",
): string | undefined {
  const cleaned = parts.map((p) => p.trim()).filter(Boolean);
  if (!cleaned.length) return undefined;
  return cleaned.join(sep);
}
