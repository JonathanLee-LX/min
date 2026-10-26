import type { Message, Tool, ToolCallPart, ToolContext, ToolResult } from "@min-agent/core";

export type PermissionAskResult = "allow" | "deny" | "allow_session";

export interface PermissionAskRequest {
  toolCall: ToolCallPart;
  reason: string;
  grantRoot?: string;
}

export type PermissionAskHandler = (
  req: PermissionAskRequest,
) => Promise<PermissionAskResult>;

export interface PermissionContext {
  toolCall: ToolCallPart;
  messages: readonly Message[];
  turn: number;
  signal?: AbortSignal;
}

export type PermissionDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | {
      action: "ask";
      reason: string;
      /** When set, approving grants this directory as a session sandbox root. */
      grantRoot?: string;
    };

export type PermissionHandler = (
  ctx: PermissionContext,
) => PermissionDecision | Promise<PermissionDecision>;

const NO_APPROVER =
  "no interactive approver; pass onPermissionAsk or --yes";

export interface PermissionGate {
  setAsk(ask: PermissionAskHandler | undefined): void;
  wrap(tools: readonly Tool[]): Tool[];
}

/**
 * Wrap tool execute with allow / deny / ask.
 * The Runner only sees the resulting tool content.
 * `grantRoot` and `allow_session` are applied by the ask callback.
 */
export function createPermissionGate(handler: PermissionHandler): PermissionGate {
  let ask: PermissionAskHandler | undefined;
  return {
    setAsk(next) {
      ask = next;
    },
    wrap(tools) {
      return tools.map((tool) => wrapTool(tool, handler, () => ask));
    },
  };
}

function wrapTool(
  tool: Tool,
  handler: PermissionHandler,
  currentAsk: () => PermissionAskHandler | undefined,
): Tool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    async execute(input: unknown, ctx: ToolContext = {}): Promise<ToolResult> {
      const args =
        input && typeof input === "object"
          ? (input as Record<string, unknown>)
          : {};
      const toolCall: ToolCallPart = {
        type: "tool_call",
        id: ctx.toolCallId ?? "",
        name: tool.name,
        arguments: args,
      };
      const decision = await handler({
        toolCall,
        messages: ctx.messages ?? [],
        turn: ctx.turn ?? 0,
        signal: ctx.signal,
      });

      if (decision.action === "allow") {
        return tool.execute(input, ctx);
      }
      if (decision.action === "deny") {
        return denied(decision.reason);
      }

      const approver = currentAsk();
      if (!approver) {
        return denied(`${decision.reason} (${NO_APPROVER})`);
      }
      const answer = await approver({
        toolCall,
        reason: decision.reason,
        grantRoot: decision.grantRoot,
      });
      if (answer === "deny") {
        return denied(decision.reason);
      }
      return tool.execute(input, ctx);
    },
  };
}

function denied(reason: string): ToolResult {
  return { content: `Permission denied: ${reason}`, isError: true };
}
