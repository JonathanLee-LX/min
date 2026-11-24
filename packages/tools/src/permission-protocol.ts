import type { BodyClock, Message, Tool, ToolCallPart, ToolContext, ToolResult } from "@min-agent/core";

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
      const clock = ctx.onBodyStart;
      // Own the display clock before any permission wait. The registry
      // will not start it, and we start it only if the body runs.
      clock?.claim();
      const quiet: ToolContext = { ...ctx, onBodyStart: undefined };
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
        return runTool(tool, input, quiet, clock);
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
      return runTool(tool, input, quiet, clock);
    },
  };
}

/**
 * Time only `tool.execute`. Permission asks happen before this, and each call
 * keeps its own start time so overlapping calls do not share a clock.
 * Abort settles with the time already spent instead of waiting out the body.
 */
async function runTool(
  tool: Tool,
  input: unknown,
  ctx: ToolContext,
  clock?: BodyClock,
): Promise<ToolResult> {
  if (ctx.signal?.aborted) {
    return { content: "aborted", isError: true, durationMs: 0 };
  }
  clock?.start();
  const started = performance.now();
  let settled = false;
  const pending = Promise.resolve()
    .then(() => tool.execute(input, ctx))
    .then(
      (result) => finish(result),
      (err: unknown) =>
        finish({
          content: err instanceof Error ? err.message : String(err),
          isError: true,
        }),
    );

  const signal = ctx.signal;
  if (!signal) return pending;

  return new Promise((resolve) => {
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve({ content: "aborted", isError: true, durationMs: elapsedMs(started) });
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then((result) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    });
  });

  function finish(result: ToolResult): ToolResult {
    return { ...result, durationMs: elapsedMs(started) };
  }
}

function elapsedMs(started: number): number {
  const ms = performance.now() - started;
  if (!Number.isFinite(ms) || ms <= 0) return 0.01;
  return ms;
}

function denied(reason: string): ToolResult {
  return { content: `Permission denied: ${reason}`, isError: true, durationMs: 0 };
}
