export type UiDensity = "comfortable" | "compact";

/** Compact mode is 0.8 of comfortable, floored to whole terminal cells. */
export const COMPACT_SCALE = 0.8;

const COMFORTABLE_PADDING_X = 1;
const COMFORTABLE_LIST_VISIBLE = 8;

export function parseUiDensity(raw: unknown): UiDensity | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "compact") return "compact";
  if (value === "comfortable" || value === "default" || value === "normal") {
    return "comfortable";
  }
  return undefined;
}

/** Scale a row or column count. Compact uses 0.8 and floors to a whole cell. */
export function scaleCount(n: number, density: UiDensity = "comfortable"): number {
  if (n <= 0) return 0;
  if (density !== "compact") return n;
  return Math.max(0, Math.floor(n * COMPACT_SCALE));
}

export function densityPaddingX(density: UiDensity = "comfortable"): number {
  return scaleCount(COMFORTABLE_PADDING_X, density);
}

export function densityListVisible(density: UiDensity = "comfortable"): number {
  return Math.max(1, scaleCount(COMFORTABLE_LIST_VISIBLE, density));
}

export function densityChromeWidth(base: number, density: UiDensity = "comfortable"): number {
  return Math.max(1, scaleCount(base, density));
}

export function toggleDensity(current: UiDensity): UiDensity {
  return current === "compact" ? "comfortable" : "compact";
}
