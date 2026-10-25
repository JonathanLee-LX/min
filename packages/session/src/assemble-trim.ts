import type { Message } from "@min/core";
import {
  splitUserTurns,
  type AssembleInput,
  type AssembleResult,
  type ContextBudget,
} from "./assemble.js";
import { defaultTokenEstimator } from "./tokens.js";

/**
 * Baseline context strategy: drop oldest user-turns until under budget.
 * No fold, no stash, no head/middle/tail split — simple and predictable
 * for A/B evaluation against H-M-T.
 */
export function assembleTrimContext(input: AssembleInput): AssembleResult {
  const estimate = input.budget.estimate ?? defaultTokenEstimator;
  const reserved = input.budget.reservedOutputTokens ?? 1024;
  const overhead =
    estimate.system(input.system) + estimate.tools(input.tools ?? []);
  const messageBudget = Math.max(
    256,
    input.budget.maxContextTokens - reserved - overhead,
  );

  let turns = splitUserTurns(input.messages);

  if (input.budget.maxUserTurns && input.budget.maxUserTurns > 0) {
    if (turns.length > input.budget.maxUserTurns) {
      turns = turns.slice(-input.budget.maxUserTurns);
    }
  }

  while (turns.length > 1) {
    const flat = turns.flat();
    if (estimate.messages(flat) <= messageBudget) break;
    turns = turns.slice(1);
  }

  const kept = turns.flat();
  const dropped = prefixBeforeSuffix(input.messages, kept);
  const viewTokens = estimate.messages(kept);

  return {
    view: kept,
    kept,
    dropped,
    estimatedTokens: overhead + viewTokens,
    messageBudget,
    trimmed: dropped.length > 0,
    foldedParts: 0,
    stashedIds: [],
    strategy: "trim",
    regions: {
      headTurns: 0,
      middleTurns: 0,
      tailTurns: kept.length ? splitUserTurns(kept).length : 0,
    },
  };
}

export type TrimBudget = Pick<
  ContextBudget,
  | "maxContextTokens"
  | "reservedOutputTokens"
  | "maxUserTurns"
  | "estimate"
>;

function prefixBeforeSuffix(full: Message[], suffix: Message[]): Message[] {
  if (!suffix.length) return [...full];
  if (suffix.length > full.length) return [];
  const start = full.length - suffix.length;
  for (let i = 0; i < suffix.length; i++) {
    if (full[start + i] !== suffix[i]) return [];
  }
  return full.slice(0, start);
}
