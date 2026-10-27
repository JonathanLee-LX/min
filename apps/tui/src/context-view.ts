import type { ContextUsage } from "@min-agent/client";
import {
  formatContextUsageBreakdown,
  formatContextUsageShort,
} from "@min-agent/client";

export function contextStatusLine(usage: ContextUsage | undefined): string {
  if (!usage) return "";
  return formatContextUsageShort(usage);
}

export function contextBreakdownLine(usage: ContextUsage | undefined): string {
  if (!usage) return "";
  return formatContextUsageBreakdown(usage);
}

/**
 * Bottom chrome: model id plus total context meter only.
 * Part breakdown stays behind `/context` (see commands), not the footer.
 */
export function bottomStatusLines(
  model: string,
  usage: ContextUsage | undefined,
): string[] {
  const ctx = contextStatusLine(usage);
  const head = [model.trim(), ctx].filter((part) => part.length > 0).join(" · ");
  return head ? [head] : [];
}
