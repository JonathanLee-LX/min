import type { Message, ToolDefinition } from "@min/core";
import {
  estimateMessagesTokens,
  estimateSystemTokens,
  estimateToolsTokens,
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
}

export interface AssembleInput {
  messages: Message[];
  system?: string;
  tools?: ToolDefinition[];
  budget: ContextBudget;
}

export interface AssembleResult {
  /** Suffix of messages sent to the model (always a suffix of input). */
  view: Message[];
  /** Leading messages dropped from the view (still kept in Session store). */
  dropped: Message[];
  /** Estimated tokens for system + tools + view. */
  estimatedTokens: number;
  /** Tokens available for messages after reserves. */
  messageBudget: number;
  trimmed: boolean;
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
 * Build a model view under a context budget by dropping oldest user-turns.
 * Canonical session history is NOT mutated here.
 */
export function assembleContext(input: AssembleInput): AssembleResult {
  const reserved = input.budget.reservedOutputTokens ?? 1024;
  const overhead =
    estimateSystemTokens(input.system) +
    estimateToolsTokens(input.tools ?? []);
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
    if (estimateMessagesTokens(flat) <= messageBudget) break;
    turns = turns.slice(1);
  }

  const view = turns.flat();
  const dropped = prefixBeforeSuffix(input.messages, view);
  const viewTokens = estimateMessagesTokens(view);

  return {
    view,
    dropped,
    estimatedTokens: overhead + viewTokens,
    messageBudget,
    trimmed: dropped.length > 0,
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
