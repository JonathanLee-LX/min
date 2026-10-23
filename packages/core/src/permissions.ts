import type { Message, ToolCallPart } from "./types.js";

/**
 * Thin permission protocol. Policy lives in tools/CLI;
 * the Runner only enforces allow | deny | ask.
 */
export type PermissionDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "ask"; reason: string };

export type PermissionAskResult = "allow" | "deny" | "allow_session";

export interface PermissionContext {
  toolCall: ToolCallPart;
  messages: Message[];
  turn: number;
  signal?: AbortSignal;
}

export type PermissionHandler = (
  ctx: PermissionContext,
) => PermissionDecision | Promise<PermissionDecision>;

export interface PermissionAskRequest {
  toolCall: ToolCallPart;
  reason: string;
}
