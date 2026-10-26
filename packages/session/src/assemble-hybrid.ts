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
import { defaultTokenEstimator } from "./tokens.js";

export interface HybridAssembleOptions {
  /** Leading user-turns kept verbatim (cache-stable). Default: 1. */
  stickyTurns?: number;
  /** Trailing user-turns whose tool_results stay verbatim. Default: 1. */
  protectTailTurns?: number;
  /**
   * Inside the active turn (sole sticky turn, or protected tail), keep the
   * last N `tool_result` messages verbatim and fold older oversized ones.
   * Closes the single user-turn + long tool-loop gap where H/M/T has no
   * middle. Default: 2. Pass `0` to fold every tool_result in that span.
   */
  protectRecentToolResults?: number;
  /** Aggressive fold defaults (smaller than plain tool-offload). */
  fold?: ContextFoldOptions | false;
}

/**
 * Hybrid strategy for harder evals:
 * 1. Freeze sticky head (prefix-cache)
 * 2. Aggressively offload tool_results outside head+tail into stash
 * 3. Age older tool_results inside the active turn (single-turn coding loops)
 * 4. If still over budget, drop oldest turns between sticky and tail
 *
 * Forces reliance on recall when earlier fat tool bodies are needed later.
 */
export function assembleHybridContext(
  input: AssembleInput,
  opts: HybridAssembleOptions = {},
): AssembleResult {
  const estimate = input.budget.estimate ?? defaultTokenEstimator;
  const reserved = input.budget.reservedOutputTokens ?? 1024;
  const overhead =
    estimate.system(input.system) + estimate.tools(input.tools ?? []);
  const messageBudget = Math.max(
    256,
    input.budget.maxContextTokens - reserved - overhead,
  );

  const stickyN = Math.max(0, opts.stickyTurns ?? 1);
  const protectTail = Math.max(0, opts.protectTailTurns ?? 1);
  const protectRecent = Math.max(0, opts.protectRecentToolResults ?? 2);
  const foldOpts =
    opts.fold === false
      ? false
      : {
          maxToolResultChars: 900,
          toolResultHeadChars: 120,
          toolResultTailChars: 120,
          ...(typeof opts.fold === "object" ? opts.fold : {}),
          ...(typeof input.budget.fold === "object" ? input.budget.fold : {}),
        };

  const turns = splitUserTurns(input.messages);
  if (!turns.length) {
    return empty(overhead, messageBudget, input.messages);
  }

  const stickyCount = Math.min(stickyN, turns.length);
  const tailCount = Math.min(
    protectTail,
    Math.max(0, turns.length - stickyCount),
  );
  const sticky = turns.slice(0, stickyCount);
  const middle = turns.slice(stickyCount, turns.length - tailCount);
  const tail = turns.slice(turns.length - tailCount);

  const stickyFlat = sticky.flat();
  const middleFlat = middle.flat();
  const tailFlat = tail.flat();

  const toolNames = indexToolNames(input.messages);
  // Fold only the middle span — sticky + tail tool bodies stay full initially.
  const preFold = [...stickyFlat, ...middleFlat, ...tailFlat];
  const midStart = stickyFlat.length;
  const midEnd = midStart + middleFlat.length;

  const folded = foldMessagesForView(preFold, {
    fold: foldOpts,
    stash: input.budget.stash,
    range: { start: midStart, end: midEnd },
    toolNameByCallId: toolNames,
  });

  let viewSticky = folded.messages.slice(0, midStart);
  let viewMiddle = folded.messages.slice(midStart, midEnd);
  let viewTail = folded.messages.slice(midEnd);
  let foldedParts = folded.foldedParts;
  const stashedIds = [...folded.stashedIds];

  // Collapse oldest middle turns if still over budget.
  let middleTurns = splitUserTurns(viewMiddle);
  while (
    estimate.messages([...viewSticky, ...middleTurns.flat(), ...viewTail]) >
      messageBudget &&
    middleTurns.length > 0
  ) {
    middleTurns = middleTurns.slice(1);
    foldedParts += 1;
  }
  viewMiddle = middleTurns.flat();

  let view = [...viewSticky, ...viewMiddle, ...viewTail];

  // Intra-turn aging: fold older tool_results inside the active span.
  // - Single user-turn (no middle/tail): age inside sticky.
  // - Multi-turn: age inside protected tail (where the tool loop grows).
  if (foldOpts) {
    const ageStart =
      middle.length === 0 && tailCount === 0
        ? 0
        : viewSticky.length + viewMiddle.length;
    const aged = ageOlderToolResults(view, {
      start: ageStart,
      end: view.length,
      protectRecent,
      fold: foldOpts,
      stash: input.budget.stash,
      toolNames,
    });
    view = aged.messages;
    foldedParts += aged.foldedParts;
    stashedIds.push(...aged.stashedIds);
    viewSticky = view.slice(0, viewSticky.length);
    viewMiddle = view.slice(
      viewSticky.length,
      viewSticky.length + viewMiddle.length,
    );
    viewTail = view.slice(viewSticky.length + viewMiddle.length);
  }

  // Last resort: fold everything after sticky (or the whole view when the
  // sole turn lives in sticky) so single-turn overflow still offloads.
  if (estimate.messages(view) > messageBudget && foldOpts) {
    const emergencyStart =
      viewSticky.length > 0 && viewSticky.length < view.length
        ? viewSticky.length
        : 0;
    const emergency = foldMessagesForView(view, {
      fold: {
        ...foldOpts,
        maxToolResultChars: 500,
        toolResultHeadChars: 80,
        toolResultTailChars: 80,
      },
      stash: input.budget.stash,
      range: { start: emergencyStart, end: view.length },
      toolNameByCallId: toolNames,
    });
    view = emergency.messages;
    foldedParts += emergency.foldedParts;
    stashedIds.push(...emergency.stashedIds);
  }

  const uniqueIds = [...new Set(stashedIds)];
  return {
    view,
    kept: input.messages,
    dropped: [],
    estimatedTokens: overhead + estimate.messages(view),
    messageBudget,
    trimmed:
      foldedParts > 0 ||
      view.length < input.messages.length ||
      uniqueIds.length > 0,
    foldedParts,
    stashedIds: uniqueIds,
    strategy: "hybrid",
    regions: {
      headTurns: stickyCount,
      middleTurns: middleTurns.length,
      tailTurns: tailCount,
    },
  };
}

/**
 * Fold oversized tool_results in [start, end) except the last
 * `protectRecent` tool_result-bearing messages (kept verbatim).
 */
export function ageOlderToolResults(
  messages: Message[],
  opts: {
    start: number;
    end: number;
    protectRecent: number;
    fold: ContextFoldOptions | false;
    stash?: AssembleInput["budget"]["stash"];
    toolNames: ReadonlyMap<string, string>;
  },
): { messages: Message[]; foldedParts: number; stashedIds: string[] } {
  if (opts.fold === false || opts.start >= opts.end) {
    return { messages, foldedParts: 0, stashedIds: [] };
  }

  const toolMsgIdx: number[] = [];
  for (let i = opts.start; i < opts.end; i++) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.content.some((p) => p.type === "tool_result")) {
      toolMsgIdx.push(i);
    }
  }

  if (toolMsgIdx.length <= opts.protectRecent) {
    return { messages, foldedParts: 0, stashedIds: [] };
  }

  const protectFrom =
    opts.protectRecent === 0
      ? opts.end
      : toolMsgIdx[toolMsgIdx.length - opts.protectRecent]!;

  if (protectFrom <= opts.start) {
    return { messages, foldedParts: 0, stashedIds: [] };
  }

  return foldMessagesForView(messages, {
    fold: opts.fold,
    stash: opts.stash,
    range: { start: opts.start, end: protectFrom },
    toolNameByCallId: opts.toolNames,
  });
}

function empty(
  overhead: number,
  messageBudget: number,
  messages: AssembleInput["messages"],
): AssembleResult {
  return {
    view: [],
    kept: messages,
    dropped: [],
    estimatedTokens: overhead,
    messageBudget,
    trimmed: false,
    foldedParts: 0,
    stashedIds: [],
    strategy: "hybrid",
    regions: { headTurns: 0, middleTurns: 0, tailTurns: 0 },
  };
}
