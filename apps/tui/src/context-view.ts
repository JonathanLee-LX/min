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
 * Bottom chrome: model id plus context meter (and optional part breakdown).
 * Provider ids are usually `vendor:model`; mock may be a bare name.
 */
export function bottomStatusLines(
  model: string,
  usage: ContextUsage | undefined,
): string[] {
  const ctx = contextStatusLine(usage);
  const head = [model.trim(), ctx].filter((part) => part.length > 0).join(" · ");
  const lines: string[] = [];
  if (head) lines.push(head);
  const parts = contextBreakdownLine(usage);
  if (parts) lines.push(parts);
  return lines;
}
