/** Thinking intensity shared by config and model adapters. */
export const REASONING_EFFORTS = ["none", "low", "medium", "high", "max"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Accept a known effort name. Blank and unknown values are dropped. */
export function parseReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim().toLowerCase();
  return (REASONING_EFFORTS as readonly string[]).includes(raw)
    ? (raw as ReasoningEffort)
    : undefined;
}
