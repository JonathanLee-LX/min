import type { Message, ToolDefinition } from "@min-agent/core";
import { defaultTokenEstimator, type TokenEstimator } from "./tokens.js";

/** Buckets shown in the context meter / breakdown. */
export type ContextPartId =
  | "system"
  | "conversation"
  | "skills"
  | "mcp"
  | "tools"
  | "reserved";

export interface ContextUsagePart {
  id: ContextPartId;
  label: string;
  tokens: number;
  /**
   * Share of {@link ContextUsage.used} for content buckets, or of
   * {@link ContextUsage.limit} for `reserved`.
   */
  share: number;
}

/**
 * Estimated context window occupancy for the current model view.
 * Tokens are chars÷4 by default — not billing-accurate.
 */
export interface ContextUsage {
  /** system + tools + conversation in the projected request. */
  used: number;
  /** Configured window (`maxContextTokens`). */
  limit: number;
  /** `used / limit` (may exceed 1 if over budget). */
  ratio: number;
  reservedOutput: number;
  parts: ContextUsagePart[];
  strategy?: string;
  /** Always true today; reserved for future provider-reported counts. */
  estimated: boolean;
}

export interface ContextSystemPart {
  id: Extract<ContextPartId, "system" | "skills" | "mcp">;
  text: string;
}

export interface ContextToolGroup {
  id: Extract<ContextPartId, "tools" | "skills" | "mcp">;
  tools: ToolDefinition[];
}

/** Optional labeled sources from the host (Runtime). */
export interface ContextPartsSnapshot {
  systemParts: ContextSystemPart[];
  toolGroups: ContextToolGroup[];
}

export interface ComputeContextUsageInput {
  limit: number;
  reservedOutput?: number;
  strategy?: string;
  messages: readonly Message[];
  /** Flat system string when labeled parts are unavailable. */
  system?: string;
  /** Flat tool list when labeled groups are unavailable. */
  tools?: readonly ToolDefinition[];
  parts?: ContextPartsSnapshot;
  estimate?: TokenEstimator;
}

const LABELS: Record<ContextPartId, string> = {
  system: "system",
  conversation: "conversation",
  skills: "skills",
  mcp: "mcp",
  tools: "tools",
  reserved: "reserved",
};

const CONTENT_ORDER: ContextPartId[] = [
  "system",
  "skills",
  "mcp",
  "tools",
  "conversation",
];

/** Build a usage snapshot for the projected model request. */
export function computeContextUsage(input: ComputeContextUsageInput): ContextUsage {
  const estimate = input.estimate ?? defaultTokenEstimator;
  const limit = Math.max(1, input.limit);
  const reservedOutput = Math.max(0, input.reservedOutput ?? 1024);

  const systemTokens = new Map<ContextPartId, number>();
  const toolTokens = new Map<ContextPartId, number>();

  if (input.parts) {
    for (const part of input.parts.systemParts) {
      const text = part.text.trim();
      if (!text) continue;
      add(systemTokens, part.id, estimate.system(text));
    }
    for (const group of input.parts.toolGroups) {
      if (!group.tools.length) continue;
      add(toolTokens, group.id, estimate.tools(group.tools));
    }
  } else {
    if (input.system?.trim()) {
      add(systemTokens, "system", estimate.system(input.system));
    }
    if (input.tools?.length) {
      add(toolTokens, "tools", estimate.tools([...input.tools]));
    }
  }

  const conversation = estimate.messages([...input.messages]);
  const systemTotal = sumMap(systemTokens);
  const toolsTotal = sumMap(toolTokens);
  const used = systemTotal + toolsTotal + conversation;

  const parts: ContextUsagePart[] = [];
  for (const id of CONTENT_ORDER) {
    let tokens = 0;
    if (id === "conversation") tokens = conversation;
    else tokens = (systemTokens.get(id) ?? 0) + (toolTokens.get(id) ?? 0);
    if (tokens <= 0 && id !== "system" && id !== "conversation" && id !== "tools") {
      continue;
    }
    if (tokens <= 0 && id === "tools" && toolsTotal === 0) continue;
    parts.push({
      id,
      label: LABELS[id],
      tokens,
      share: used > 0 ? tokens / used : 0,
    });
  }

  parts.push({
    id: "reserved",
    label: LABELS.reserved,
    tokens: reservedOutput,
    share: limit > 0 ? reservedOutput / limit : 0,
  });

  return {
    used,
    limit,
    ratio: used / limit,
    reservedOutput,
    parts,
    strategy: input.strategy,
    estimated: true,
  };
}

/** Attach {@link ContextUsage} onto an assemble result. */
export function withContextUsage<T extends { view: Message[]; strategy?: string; estimatedTokens: number }>(
  result: T,
  input: Omit<ComputeContextUsageInput, "messages" | "strategy"> & {
    messages?: readonly Message[];
  },
): T & { usage: ContextUsage } {
  const usage = computeContextUsage({
    ...input,
    messages: input.messages ?? result.view,
    strategy: result.strategy,
  });
  return { ...result, usage };
}

/** Compact header fragment, e.g. `ctx 12.4k/32k 39%`. */
export function formatContextUsageShort(usage: ContextUsage): string {
  const pct = Math.round(usage.ratio * 100);
  return `ctx ${formatTokenCount(usage.used)}/${formatTokenCount(usage.limit)} ${pct}%`;
}

/** Breakdown line, e.g. `sys 12% · conv 61% · tools 18% · skills 9%`. */
export function formatContextUsageBreakdown(usage: ContextUsage): string {
  const content = usage.parts.filter((part) => part.id !== "reserved" && part.tokens > 0);
  if (!content.length) return "";
  return content
    .map((part) => `${shortLabel(part.id)} ${Math.round(part.share * 100)}%`)
    .join(" · ");
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(Math.max(0, Math.round(tokens)));
  if (tokens < 10_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.round(tokens / 1000)}k`;
}

function shortLabel(id: ContextPartId): string {
  switch (id) {
    case "system":
      return "sys";
    case "conversation":
      return "conv";
    case "skills":
      return "skills";
    case "mcp":
      return "mcp";
    case "tools":
      return "tools";
    case "reserved":
      return "rsv";
  }
}

function add(map: Map<ContextPartId, number>, id: ContextPartId, n: number): void {
  map.set(id, (map.get(id) ?? 0) + n);
}

function sumMap(map: Map<ContextPartId, number>): number {
  let total = 0;
  for (const n of map.values()) total += n;
  return total;
}
