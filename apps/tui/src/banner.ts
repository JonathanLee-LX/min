import { displayWidth } from "./text.js";

/**
 * Header wordmark for min.
 *
 * Wide enough terminals get a three-row double-line glyph; tighter ones fall
 * back to a single mark so the transcript keeps most of the screen.
 */

const BANNER_FULL = ["╔╦╗ ╦ ╔╗╗", "║║║ ║ ║║║", "╩╩╝ ╩ ╝╚╝"] as const;

const BANNER_TAG = "agent";

/** Compact one-line mark when the terminal is too tight for the glyph. */
const BANNER_COMPACT = "MIN";

export function minBannerLines(columns: number): string[] {
  const width = Math.max(1, columns);
  const glyphWidth = displayWidth(BANNER_FULL[0]!);
  if (width < glyphWidth) {
    return [BANNER_COMPACT];
  }
  const tagBudget = width - glyphWidth - 2;
  if (tagBudget >= displayWidth(BANNER_TAG)) {
    return [BANNER_FULL[0]!, `${BANNER_FULL[1]!}  ${BANNER_TAG}`, BANNER_FULL[2]!];
  }
  return [...BANNER_FULL];
}

export function minBannerRows(columns: number): number {
  return minBannerLines(columns).length;
}
