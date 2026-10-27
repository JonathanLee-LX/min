/**
 * Terminal focus reporting (DECSET 1004).
 *
 * When enabled, the host sends `\x1b[I` (focus in) / `\x1b[O` (focus out).
 * Unfocused tabs still receive timer/stream paints; pausing Ink updates while
 * unfocused stops the eraseLines flicker that shows up in background tabs.
 */

export const FOCUS_IN = "\x1b[I";
export const FOCUS_OUT = "\x1b[O";

/** Enable focus events on this TTY. Safe no-op when not a TTY. */
export function enableFocusReporting(stdout: NodeJS.WriteStream): () => void {
  if (!stdout.isTTY) return () => {};
  stdout.write("\x1b[?1004h");
  return () => {
    try {
      stdout.write("\x1b[?1004l");
    } catch {
      /* exiting */
    }
  };
}

/** True when the chunk is only a focus in/out report (possibly repeated). */
export function isFocusChunk(chunk: string): boolean {
  if (!chunk) return false;
  return /^(?:\x1b\[[IO])+$/.test(chunk);
}

/** Parse a focus report. Mixed chunks with other input return null. */
export function focusStateFromChunk(chunk: string): boolean | null {
  if (!isFocusChunk(chunk)) return null;
  // Last report wins if the host batched several.
  return chunk.endsWith(FOCUS_IN);
}
