import type { Message, ToolDefinition } from "@min/core";
import {
  foldMessagesForView,
  shrinkToolResultsToFit,
  type ContextFoldOptions,
} from "./fold.js";
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
  /** Hard cap on how many trailing user-turns to keep (after budget trim). */
  maxUserTurns?: number;
  /**
   * Fold long tool_result bodies in the model view only.
   * Pass `false` to disable. Default: enabled with {@link ContextFoldOptions} defaults.
   */
  fold?: ContextFoldOptions | false;
  /** Override token estimation (tests / model-specific counters). */
  estimate?: TokenEstimator;
}

export interface AssembleInput {
  messages: Message[];
  system?: string;
  tools?: ToolDefinition[];
  budget: ContextBudget;
}

export interface AssembleResult {
  /** Suffix of messages sent to the model (may be folded clones). */
  view: Message[];
  /**
   * Unfolded suffix of the canonical history matching `view` 1:1.
   * Session merges `dropped + kept + generated` so folding never rewrites store.
   * Custom assemblers may omit this; Session falls back to `view`.
   */
  kept?: Message[];
  /** Leading messages dropped from the view (still kept in Session store). */
  dropped: Message[];
  /** Estimated tokens for system + tools + view. */
  estimatedTokens: number;
  /** Tokens available for messages after reserves. */
  messageBudget: number;
  /** True when turns were dropped and/or content was folded/shrunk. */
  trimmed: boolean;
  /** Number of tool_result parts folded or shrunk in the view. */
  foldedParts?: number;
}

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
 * Build a model view under a context budget by dropping oldest user-turns,
 * folding long tool results, and shrinking further if a single turn still
 * overflows. Canonical session history is NOT mutated here.
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

  // Fold on clones for the model view; `kept` retains canonical objects.
  const folded = foldMessagesForView(kept, input.budget.fold);
  let view = folded.messages;
  let foldedParts = folded.foldedParts;

  if (estimate.messages(view) > messageBudget) {
    const shrunk = shrinkToolResultsToFit(
      view,
      messageBudget,
      (msgs) => estimate.messages(msgs),
      input.budget.fold === false ? {} : input.budget.fold,
    );
    foldedParts += shrunk.foldedParts;
  }

  const viewTokens = estimate.messages(view);
  const turnTrimmed = dropped.length > 0;

  return {
    view,
    kept,
    dropped,
    estimatedTokens: overhead + viewTokens,
    messageBudget,
    trimmed: turnTrimmed || foldedParts > 0,
    foldedParts,
  };
}

function prefixBeforeSuffix(full: Message[], suffix: Message[]): Message[] {
  if (!suffix.length) return [...full];
  if (suffix.length > full.length) return [];
  const start = full.length - suffix.length;
  for (let i = 0; i < suffix.length; i++) {
    if (full[start + i] !== suffix[i]) {
      // Fallback: view should always be built as a suffix; if not, drop nothing
      return [];
    }
  }
  return full.slice(0, start);
}

export type { ContextFoldOptions };
