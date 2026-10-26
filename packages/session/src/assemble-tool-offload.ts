import type { Message } from "@min-agent/core";
import {
  splitUserTurns,
  type AssembleInput,
  type AssembleResult,
} from "./assemble.js";
import {
  foldMessagesForView,
  indexToolNames,
  type ContextFoldOptions,
} from "./fold.js";
import type { ContextStash } from "./stash.js";
import { defaultTokenEstimator } from "./tokens.js";

export interface ToolOffloadOptions {
  /**
   * Keep the last N user-turns' tool_results verbatim (current work).
   * Default: 1.
   */
  protectTailTurns?: number;
  /** Fold knobs; default maxToolResultChars=4000. */
  fold?: ContextFoldOptions | false;
}

/**
 * Offload oversized tool_results into a stash across the whole history
 * (except a protected tail), independent of H/M/T position.
 * Then drop oldest turns if still over token budget.
 * Canonical history is not rewritten (`kept` = full input).
 */
export function assembleToolOffloadContext(
  input: AssembleInput,
  opts: ToolOffloadOptions = {},
): AssembleResult {
  const estimate = input.budget.estimate ?? defaultTokenEstimator;
  const reserved = input.budget.reservedOutputTokens ?? 1024;
  const overhead =
    estimate.system(input.system) + estimate.tools(input.tools ?? []);
  const messageBudget = Math.max(
    256,
    input.budget.maxContextTokens - reserved - overhead,
  );

  const protectTail = Math.max(0, opts.protectTailTurns ?? 1);
  const foldOpts =
    opts.fold === false
      ? false
      : {
          maxToolResultChars: 4000,
          toolResultHeadChars: 400,
          toolResultTailChars: 400,
          ...(typeof opts.fold === "object" ? opts.fold : {}),
        };

  const turns = splitUserTurns(input.messages);
  const protectStartTurn = Math.max(0, turns.length - protectTail);
  let messageIndex = 0;
  const turnStarts: number[] = [];
  for (const turn of turns) {
    turnStarts.push(messageIndex);
    messageIndex += turn.length;
  }
  const protectMsgStart =
    protectStartTurn < turnStarts.length
      ? turnStarts[protectStartTurn]!
      : input.messages.length;

  const toolNames = indexToolNames(input.messages);
  const folded = foldMessagesForView(input.messages, {
    fold: foldOpts,
    stash: input.budget.stash,
    range: { start: 0, end: protectMsgStart },
    toolNameByCallId: toolNames,
  });

  let viewTurns = splitUserTurns(folded.messages);
  if (input.budget.maxUserTurns && input.budget.maxUserTurns > 0) {
    if (viewTurns.length > input.budget.maxUserTurns) {
      viewTurns = viewTurns.slice(-input.budget.maxUserTurns);
    }
  }

  let foldedParts = folded.foldedParts;
  const stashedIds = [...folded.stashedIds];

  while (viewTurns.length > 1) {
    const flat = viewTurns.flat();
    if (estimate.messages(flat) <= messageBudget) break;
    // Prefer dropping unprotected (older) turns first.
    viewTurns = viewTurns.slice(1);
  }

  const view = viewTurns.flat();
  // If a single protected turn still overflows, fold inside it too.
  if (estimate.messages(view) > messageBudget && foldOpts) {
    const emergency = foldMessagesForView(view, {
      fold: {
        ...foldOpts,
        maxToolResultChars: Math.min(
          typeof foldOpts.maxToolResultChars === "number"
            ? foldOpts.maxToolResultChars
            : 4000,
          1500,
        ),
      },
      stash: input.budget.stash,
      toolNameByCallId: toolNames,
    });
    return {
      view: emergency.messages,
      kept: input.messages,
      dropped: [],
      estimatedTokens: overhead + estimate.messages(emergency.messages),
      messageBudget,
      trimmed: true,
      foldedParts: foldedParts + emergency.foldedParts,
      stashedIds: unique([...stashedIds, ...emergency.stashedIds]),
      strategy: "tool-offload",
      regions: {
        headTurns: 0,
        middleTurns: Math.max(0, turns.length - protectTail),
        tailTurns: Math.min(protectTail, turns.length),
      },
    };
  }

  const trimmed =
    foldedParts > 0 ||
    view.length < folded.messages.length ||
    stashedIds.length > 0;

  return {
    view,
    kept: input.messages,
    dropped: [],
    estimatedTokens: overhead + estimate.messages(view),
    messageBudget,
    trimmed,
    foldedParts,
    stashedIds: unique(stashedIds),
    strategy: "tool-offload",
    regions: {
      headTurns: 0,
      middleTurns: Math.max(0, turns.length - protectTail),
      tailTurns: Math.min(protectTail, turns.length),
    },
  };
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}
