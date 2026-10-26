import type { Message, ToolDefinition } from "@min-agent/core";

/**
 * Pluggable token estimator for context budgeting.
 * Default is a rough chars/4 heuristic — not billing-accurate.
 */
export interface TokenEstimator {
  text(text: string): number;
  message(message: Message): number;
  messages(messages: Message[]): number;
  tools(tools: ToolDefinition[]): number;
  system(system?: string): number;
}

/**
 * Rough token estimate for budgeting (not a billing-accurate tokenizer).
 * ~4 chars/token for mixed EN/code; JSON punctuation counted too.
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessageTokens(message: Message): number {
  let n = 4; // role / framing overhead
  for (const part of message.content) {
    if (part.type === "text") {
      n += estimateTextTokens(part.text);
    } else if (part.type === "tool_call") {
      n += estimateTextTokens(part.name);
      n += estimateTextTokens(JSON.stringify(part.arguments ?? {}));
      n += 8;
    } else if (part.type === "tool_result") {
      n += estimateTextTokens(part.content);
      n += 8;
    }
  }
  return n;
}

export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

export function estimateToolsTokens(tools: ToolDefinition[]): number {
  if (!tools.length) return 0;
  return estimateTextTokens(JSON.stringify(tools)) + tools.length * 4;
}

export function estimateSystemTokens(system?: string): number {
  return system ? estimateTextTokens(system) + 4 : 0;
}

export const defaultTokenEstimator: TokenEstimator = {
  text: estimateTextTokens,
  message: estimateMessageTokens,
  messages: estimateMessagesTokens,
  tools: estimateToolsTokens,
  system: estimateSystemTokens,
};
