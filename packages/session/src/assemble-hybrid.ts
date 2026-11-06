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

/** Recalled pages stay in the view so the model can use them. */
export const HYBRID_PROTECT_TOOL_NAMES = ["recall_context"] as const;

export interface HybridAssembleOptions {
  /** Leading user-turns kept verbatim (cache-stable). Default: 1. */
  stickyTurns?: number;
  /** Trailing user-turns whose tool_results stay verbatim. Default: 1. */
  protectTailTurns?: number;
  /**
   * Inside the active turn (sole sticky turn, or protected tail), keep the
   * last N `tool_result` messages verbatim and fold older oversized ones.
   * Default: 0 (fold every oversized body, including the most recent).
   * Fat reads then compress even under the 256k default; `recall_context`
   * recovers a hidden span. Pass a positive N to keep the last N full.
   */
  protectRecentToolResults?: number;
  /**
   * Fold knobs for middle offload and intra-turn aging (always on).
   * Smaller than plain tool-offload so overflow still offloads tightly.
   */
  fold?: ContextFoldOptions | false;
}

/**
 * Hybrid strategy:
 * 1. Freeze sticky head (prefix-cache)
 * 2. Fold oversized middle tool_results into stash (even under budget)
 * 3. If over budget, drop oldest middle turns
 * 4. Age tool_results in the active turn (default: every oversized body;
 *    `recall_context` results are not aged)
 * 5. If still over, emergency-fold after sticky (recall pages last)
 *
 * Folding compresses; one default `recall_context` page (12k from offset 0)
 * should expose a needle that sits past the 120-char fold head. Recalled
 * pages stay verbatim until a true last-resort fold, so a second recall of
 * the same id is not required.
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
  const protectRecent = Math.max(0, opts.protectRecentToolResults ?? 0);
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
  const preFold = [...stickyFlat, ...middleFlat, ...tailFlat];
  const midStart = stickyFlat.length;
  const midEnd = midStart + middleFlat.length;

  const cloned = foldMessagesForView(preFold, { fold: false });
  let viewSticky = cloned.messages.slice(0, midStart);
  let viewMiddle = cloned.messages.slice(midStart, midEnd);
  let viewTail = cloned.messages.slice(midEnd);
  let foldedParts = 0;
  const stashedIds: string[] = [];

  const fits = (msgs: Message[]) => estimate.messages(msgs) <= messageBudget;

  let view = [...viewSticky, ...viewMiddle, ...viewTail];

  // Always shrink oversized middle tool bodies, including under the 256k
  // default. Collapse of whole turns stays budget-gated.
  if (foldOpts && viewMiddle.length > 0) {
    const folded = foldMessagesForView(view, {
      fold: foldOpts,
      stash: input.budget.stash,
      range: {
        start: viewSticky.length,
        end: viewSticky.length + viewMiddle.length,
      },
      toolNameByCallId: toolNames,
      protectToolNames: HYBRID_PROTECT_TOOL_NAMES,
    });
    view = folded.messages;
    foldedParts += folded.foldedParts;
    stashedIds.push(...folded.stashedIds);
    viewSticky = view.slice(0, viewSticky.length);
    viewMiddle = view.slice(
      viewSticky.length,
      viewSticky.length + viewMiddle.length,
    );
    viewTail = view.slice(viewSticky.length + viewMiddle.length);
  }

  // Collapse oldest middle turns if still over budget.
  let middleTurns = splitUserTurns(viewMiddle);
  while (
    !fits([...viewSticky, ...middleTurns.flat(), ...viewTail]) &&
    middleTurns.length > 0
  ) {
    middleTurns = middleTurns.slice(1);
    foldedParts += 1;
  }
  viewMiddle = middleTurns.flat();
  view = [...viewSticky, ...viewMiddle, ...viewTail];

  // Intra-turn aging even under budget so a 256k single-turn loop still
  // compresses fat bodies. Default protectRecent=0 folds every oversized
  // result, including the most recent; recall_context pages are skipped.
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
      protectToolNames: HYBRID_PROTECT_TOOL_NAMES,
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

  // Last resort: fold after sticky (or the whole view when the sole turn
  // lives in sticky). Keep `recall_context` pages on the first pass so a
  // just-recalled span remains usable; fold them only if still over budget.
  if (!fits(view) && foldOpts) {
    const emergencyStart =
      viewSticky.length > 0 && viewSticky.length < view.length
        ? viewSticky.length
        : 0;
    const emergencyFold = {
      ...foldOpts,
      maxToolResultChars: 500,
      toolResultHeadChars: 80,
      toolResultTailChars: 80,
    };
    const first = foldMessagesForView(view, {
      fold: emergencyFold,
      stash: input.budget.stash,
      range: { start: emergencyStart, end: view.length },
      toolNameByCallId: toolNames,
      protectToolNames: HYBRID_PROTECT_TOOL_NAMES,
    });
    view = first.messages;
    foldedParts += first.foldedParts;
    stashedIds.push(...first.stashedIds);
    if (!fits(view)) {
      // Shrink remaining pages (including recall) without minting nested
      // hidden ids. The original stash entry is still recallable.
      const last = foldMessagesForView(view, {
        fold: emergencyFold,
        range: { start: emergencyStart, end: view.length },
        toolNameByCallId: toolNames,
      });
      view = last.messages;
      foldedParts += last.foldedParts;
    }
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
 * `protectRecent === 0` folds the whole span.
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
    protectToolNames?: readonly string[];
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
    protectToolNames: opts.protectToolNames,
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
