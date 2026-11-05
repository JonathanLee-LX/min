import { displayWidth } from "./text.js";

/**
 * Header wordmark for min — a large, slightly deformed MIN glyph.
 * Narrow terminals fall back to a compact mark.
 */

/** Full artistic glyph (~28 cols × 6 rows). */
const BANNER_FULL = [
  "  ███╗   ███╗ ██╗ ███╗   ██╗",
  "  ████╗ ████║ ██║ ████╗  ██║",
  "  ██╔████╔██║ ██║ ██╔██╗ ██║",
  "  ██║╚██╔╝██║ ██║ ██║╚██╗██║",
  "  ██║ ╚═╝ ██║ ██║ ██║ ╚████║",
  "  ╚═╝     ╚═╝ ╚═╝ ╚═╝  ╚═══╝",
] as const;

/** Mid-size glyph when the full mark does not fit. */
const BANNER_MID = [
  "▛▙   ▛▙ ▛█▜ ▛▙  ▛▙",
  "▌█▙ ▛█▌ ▐█▌ ▌█▙ ▐▌",
  "▌▐█▟█▐▌ ▐█▌ ▌▐█▖▐▌",
  "▌ ▜█▛▐▌ ▐█▌ ▌ ▜█▐▌",
  "▘  ▀ ▝▘ ▝▀▘ ▘  ▜█▘",
] as const;

/** Compact one-line mark when even the mid glyph is too wide. */
const BANNER_COMPACT = "MIN";

function fits(lines: readonly string[], columns: number): boolean {
  return lines.every((line) => displayWidth(line) <= columns);
}

export function minBannerLines(columns: number): string[] {
  const width = Math.max(1, columns);
  if (fits(BANNER_FULL, width)) return [...BANNER_FULL];
  if (fits(BANNER_MID, width)) return [...BANNER_MID];
  return [BANNER_COMPACT];
}

export function minBannerRows(columns: number): number {
  return minBannerLines(columns).length;
}
