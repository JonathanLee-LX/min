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
