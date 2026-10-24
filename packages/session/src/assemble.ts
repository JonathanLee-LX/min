import type { Message, ToolDefinition } from "@min/core";
import { assistantMessage, textPart } from "@min/core";
import {
  foldMessagesForView,
  indexToolNames,
  type ContextFoldOptions,
} from "./fold.js";
import type { ContextStash } from "./stash.js";
import {
  defaultTokenEstimator,
  type TokenEstimator,
} from "./tokens.js";

export interface ContextBudget {
  /**
   * Max tokens for the model request envelope (system + tools + messages).
   * Default applied by Session if omitted.
   */
  maxContextTokens: number;
  /** Reserve for model output / safety margin. Default 1024. */
  reservedOutputTokens?: number;
  /**
   * Keep the first N user-turns verbatim (cache-stable prefix).
   * Default: 1.
   */
  headTurns?: number;
  /**
   * Keep the last N user-turns verbatim (recent work / success).
   * Default: 2.
   */
  tailTurns?: number;
  /**
   * Soft cap on total user-turns kept in the view (head + middle + tail).
   * Excess is taken from the middle first.
   */
  maxUserTurns?: number;
  /**
   * Fold long tool_result bodies in the **middle** only.
   * Pass `false` to disable. Default: enabled.
   */
  fold?: ContextFoldOptions | false;
  /** Override token estimation (tests / model-specific counters). */
  estimate?: TokenEstimator;
  /**
   * Stash for hidden originals. When set, fold markers carry
   * `[hidden:<id> · recall_context]` and bodies are recallable.
   */
  stash?: ContextStash;
}

export interface AssembleInput {
  messages: Message[];
  system?: string;
  tools?: ToolDefinition[];
  budget: ContextBudget;
}

export interface AssembleResult {
  /** Messages sent to the model (H-M-T projection; middle may be folded). */
  view: Message[];
  /**
   * Canonical messages to keep in the session store for this turn.
   * Always the full pending history under H-M-T (fold never rewrites store).
   */
  kept?: Message[];
  /**
   * @deprecated Under H-M-T this is always empty — middle is projected away
   * from the view only. Kept for callers that still read the field.
   */
  dropped: Message[];
  /** Estimated tokens for system + tools + view. */
  estimatedTokens: number;
  /** Tokens available for messages after reserves. */
  messageBudget: number;
  /** True when middle was folded and/or collapsed. */
  trimmed: boolean;
  /** Number of tool_result parts folded in the view. */
  foldedParts?: number;
  /** Stash ids registered during this assemble. */
  stashedIds?: string[];
  /** Turn split used for this view. */
  regions?: {
    headTurns: number;
    middleTurns: number;
    tailTurns: number;
  };
}

const DEFAULT_HEAD_TURNS = 1;
const DEFAULT_TAIL_TURNS = 2;

/**
 * Split into user-turns: each turn starts at a user message and includes
 * following assistant/tool messages until the next user message.
 */
export function splitUserTurns(messages: Message[]): Message[][] {
  const turns: Message[][] = [];
  let current: Message[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      if (current.length) turns.push(current);
      current = [msg];
    } else if (!current.length) {
      current = [msg];
    } else {
      current.push(msg);
    }
  }
  if (current.length) turns.push(current);
  return turns;
}

/**
 * Build a model view with head / middle / tail retention:
 * - **Head** — first user-turns, verbatim (prefix-cache friendly)
 * - **Tail** — last user-turns, verbatim (task success)
 * - **Middle** — fold long tool_results (stash + recall ids); collapse
 *   whole middle turns if still over budget
 *
 * Canonical session history is NOT mutated.
 */
export function assembleContext(input: AssembleInput): AssembleResult {
  const estimate = input.budget.estimate ?? defaultTokenEstimator;
  const reserved = input.budget.reservedOutputTokens ?? 1024;
  const overhead =
    estimate.system(input.system) + estimate.tools(input.tools ?? []);
  const messageBudget = Math.max(
    256,
    input.budget.maxContextTokens - reserved - overhead,
  );

  const turns = splitUserTurns(input.messages);
  const headN = Math.max(0, input.budget.headTurns ?? DEFAULT_HEAD_TURNS);
  const tailN = Math.max(0, input.budget.tailTurns ?? DEFAULT_TAIL_TURNS);
  const { head, middle, tail } = splitRegions(turns, headN, tailN);

  let middleTurns = middle;
  if (input.budget.maxUserTurns && input.budget.maxUserTurns > 0) {
    const maxMiddle = Math.max(
      0,
      input.budget.maxUserTurns - head.length - tail.length,
    );
    if (middleTurns.length > maxMiddle) {
      // Drop oldest middle turns from the view (stash tool bodies first).
      const removed = middleTurns.slice(0, middleTurns.length - maxMiddle);
      stashTurnToolResults(removed.flat(), input.budget.stash, input.messages);
      middleTurns = middleTurns.slice(middleTurns.length - maxMiddle);
    }
  }

  const headFlat = head.flat();
  const middleFlat = middleTurns.flat();
  const tailFlat = tail.flat();

  // Clone full projection then fold only the middle span.
  const preFold = [...headFlat, ...middleFlat, ...tailFlat];
  const middleStart = headFlat.length;
  const middleEnd = middleStart + middleFlat.length;
  const toolNames = indexToolNames(input.messages);

  const folded = foldMessagesForView(preFold, {
    fold: input.budget.fold,
    stash: input.budget.stash,
    range: { start: middleStart, end: middleEnd },
    toolNameByCallId: toolNames,
  });

  let view = folded.messages;
  let foldedParts = folded.foldedParts;
  const stashedIds = [...folded.stashedIds];

  // If still over budget, collapse oldest middle turns into a stub.
  while (
    estimate.messages(view) > messageBudget &&
    middleTurns.length > 0
  ) {
    const removed = middleTurns[0]!;
    middleTurns = middleTurns.slice(1);
    const removedIds = stashTurnToolResults(
      removed,
      input.budget.stash,
      input.messages,
    );
    stashedIds.push(...removedIds);

    const stubIds = unique(stashedIds);
    const stub = middleStub(stubIds);
    view = [
      ...cloneMessages(headFlat),
      ...(stubIds.length ? [stub] : []),
      ...foldMessagesForView(middleTurns.flat(), {
        fold: input.budget.fold,
        stash: input.budget.stash,
        toolNameByCallId: toolNames,
      }).messages,
      ...cloneMessages(tailFlat),
    ];
    // Re-count folds roughly from view markers — keep prior foldedParts.
    foldedParts += 1;
  }

  // Last resort: middle empty but still over budget (huge head/tail tool).
  // Fold largest tool_results outside head-only protection… allow fold on
  // non-tail first, then tail, always via stash when available.
  if (estimate.messages(view) > messageBudget) {
    const lastResort = foldOverflowOutsideCore(
      view,
      messageBudget,
      estimate.messages,
      input.budget,
      headFlat.length,
      toolNames,
    );
    view = lastResort.messages;
    foldedParts += lastResort.foldedParts;
    stashedIds.push(...lastResort.stashedIds);
  }

  const viewTokens = estimate.messages(view);
  const trimmed =
    foldedParts > 0 ||
    middleTurns.length < middle.length ||
    stashedIds.length > 0;

  return {
    view,
    kept: input.messages,
    dropped: [],
    estimatedTokens: overhead + viewTokens,
    messageBudget,
    trimmed,
    foldedParts,
    stashedIds: unique(stashedIds),
    regions: {
      headTurns: head.length,
      middleTurns: middleTurns.length,
      tailTurns: tail.length,
    },
  };
}

function splitRegions(
  turns: Message[][],
  headN: number,
  tailN: number,
): {
  head: Message[][];
  middle: Message[][];
  tail: Message[][];
} {
  if (turns.length === 0) {
    return { head: [], middle: [], tail: [] };
  }
  if (headN + tailN >= turns.length) {
    // Not enough turns for a middle — prefer tail for success, rest is head.
    const t = Math.min(tailN, turns.length);
    const h = turns.length - t;
    return {
      head: turns.slice(0, h),
      middle: [],
      tail: turns.slice(h),
    };
  }
  return {
    head: turns.slice(0, headN),
    middle: turns.slice(headN, turns.length - tailN),
    tail: turns.slice(turns.length - tailN),
  };
}

function stashTurnToolResults(
  turn: Message[],
  stash: ContextStash | undefined,
  all: Message[],
): string[] {
  if (!stash) return [];
  const names = indexToolNames(all);
  const ids: string[] = [];
  for (const msg of turn) {
    for (const part of msg.content) {
      if (part.type !== "tool_result") continue;
      const entry = stash.put({
        kind: "tool_result",
        content: part.content,
        toolCallId: part.toolCallId,
        toolName: names.get(part.toolCallId),
        id: `tool_${part.toolCallId}`,
      });
      ids.push(entry.id);
    }
  }
  return ids;
}

function middleStub(ids: string[]): Message {
  const list = ids.length ? ids.join(", ") : "(none)";
  return assistantMessage([
    textPart(
      `[context] Middle turns were hidden to protect the cache-stable head and recent tail. Hidden ids: ${list}. Call recall_context to fetch originals (omit id to list).`,
    ),
  ]);
}

function foldOverflowOutsideCore(
  view: Message[],
  messageBudget: number,
  estimateMessages: (msgs: Message[]) => number,
  budget: ContextBudget,
  headLen: number,
  toolNames: Map<string, string>,
): { messages: Message[]; foldedParts: number; stashedIds: string[] } {
  // Fold from just after head through end (includes former middle+tail clones).
  const folded = foldMessagesForView(view, {
    fold: {
      ...(typeof budget.fold === "object" ? budget.fold : {}),
      maxToolResultChars:
        typeof budget.fold === "object" &&
        typeof budget.fold.maxToolResultChars === "number"
          ? Math.min(budget.fold.maxToolResultChars, 2000)
          : 2000,
    },
    stash: budget.stash,
    range: { start: headLen, end: view.length },
    toolNameByCallId: toolNames,
  });
  if (estimateMessages(folded.messages) <= messageBudget) {
    return folded;
  }
  // Still over: fold entire view including head tool results (rare).
  return foldMessagesForView(folded.messages, {
    fold: {
      maxToolResultChars: 1000,
      toolResultHeadChars: 400,
      toolResultTailChars: 400,
    },
    stash: budget.stash,
    toolNameByCallId: toolNames,
  });
}

function cloneMessages(messages: Message[]): Message[] {
  return foldMessagesForView(messages, { fold: false }).messages;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

export type { ContextFoldOptions };
