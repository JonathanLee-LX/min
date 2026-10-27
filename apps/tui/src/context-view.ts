import type { ContextUsage } from "@min-agent/client";
import {
  formatContextUsageBreakdown,
  formatContextUsageShort,
} from "@min-agent/client";
import {
  bottomStatusLines as statusBarLines,
  contextPercentLabel,
} from "./status-bar.js";

export function contextStatusLine(usage: ContextUsage | undefined): string {
  if (!usage) return "";
  return formatContextUsageShort(usage);
}

export function contextBreakdownLine(usage: ContextUsage | undefined): string {
  if (!usage) return "";
  return formatContextUsageBreakdown(usage);
}

/**
 * Bottom chrome: cwd[+branch] and model (thinking) + context %.
 * Part breakdown stays behind `/context`, not the footer.
 */
export function bottomStatusLines(
  cwd: string,
  providerId: string,
  usage: ContextUsage | undefined,
  branch?: string | null,
): string[] {
  return statusBarLines(cwd, providerId, usage, branch);
}

/** @deprecated Prefer {@link contextPercentLabel} from status-bar. */
export function contextPercent(usage: ContextUsage | undefined): string {
  return contextPercentLabel(usage);
}
