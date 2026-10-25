import { HookBus } from "./extension.js";
import {
  lastAssistantText,
  messageToolCalls,
  toolMessage,
  toolResultPart,
  userMessage,
} from "./messages.js";
import type { PermissionHandler } from "./permissions.js";
import type { ModelProvider } from "./provider.js";
import type { ToolRegistry } from "./tools.js";
import type { Message, RunEvent, RunInput, RunResult } from "./types.js";

function isAbortLike(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return e.name === "AbortError" || /aborted|abort/i.test(e.message ?? "");
}

export interface RunnerOptions {
  provider: ModelProvider;
  tools: ToolRegistry;
  hooks: HookBus;
  /** Static system prompt, or a getter so extensions can append mid-run. */
  system?: string | (() => string | undefined);
  maxTurns?: number;
  maxTokens?: number;
  permissionHandler?: PermissionHandler;
  /**
   * Default message projector (overridden by RunInput.projectMessages).
   * View-only — never written back into the Runner message list.
   */
  projectMessages?: (
    messages: readonly Message[],
  ) => Message[] | Promise<Message[]>;
}

export class Runner {
  constructor(private readonly opts: RunnerOptions) {}

  async run(input: RunInput): Promise<RunResult> {
    const maxTurns = input.maxTurns ?? this.opts.maxTurns ?? 16;
    const signal = input.signal;

    const messages: Message[] =
      typeof input.input === "string"
        ? [userMessage(input.input)]
        : [...input.input];

    const emit = async (event: RunEvent) => {
      await input.onEvent?.(event);
    };

    let turns = 0;

    try {
      while (turns < maxTurns) {
        if (signal?.aborted) {
          throw new DOMException("Run aborted", "AbortError");
        }

        turns += 1;
        const hookCtx = { messages, turn: turns, signal };
        await this.opts.hooks.emitBeforeTurn(hookCtx);
        await emit({ type: "turn_start", turn: turns });

        const toolDefs = this.opts.tools.definitions();
        const system =
          typeof this.opts.system === "function"
            ? this.opts.system()
            : this.opts.system;
        const project =
          input.projectMessages ?? this.opts.projectMessages;
        const modelMessages = project
          ? await project(messages)
          : messages;
        const completionReq = {
          messages: modelMessages,
          tools: toolDefs.length ? toolDefs : undefined,
          system,
          maxTokens: this.opts.maxTokens,
          signal,
        };
        const result = await this.completeTurn(completionReq, emit);

        messages.push(result.message);
        await this.opts.hooks.emitAfterTurn({ ...hookCtx, message: result.message });
        await emit({ type: "turn_end", turn: turns, message: result.message });

        const toolCalls = messageToolCalls(result.message);
        if (!toolCalls.length || result.stopReason === "end") {
          break;
        }

        const results = [];
        for (const call of toolCalls) {
          await emit({ type: "tool_call", toolCall: call });
          await this.opts.hooks.emitBeforeTool({ ...hookCtx, toolCall: call });

          const permitted = await this.resolvePermission(input, {
            toolCall: call,
            messages,
            turn: turns,
            signal,
          });

          if (!permitted.ok) {
            await emit({
              type: "permission",
              toolCall: call,
              decision: "deny",
              reason: permitted.reason,
            });
            const denied = {
              content: `Permission denied: ${permitted.reason}`,
              isError: true as const,
            };
            await this.opts.hooks.emitAfterTool({
              ...hookCtx,
              toolCall: call,
              result: denied,
            });
            await emit({
              type: "tool_result",
              toolCallId: call.id,
              content: denied.content,
              isError: true,
            });
            results.push(toolResultPart(call.id, denied.content, true));
            continue;
          }

          await emit({
            type: "permission",
            toolCall: call,
            decision: "allow",
            reason: permitted.reason,
          });

          const toolResult = await this.opts.tools.execute(
            call.name,
            call.arguments,
            { signal },
          );

          await this.opts.hooks.emitAfterTool({
            ...hookCtx,
            toolCall: call,
            result: toolResult,
          });
          await emit({
            type: "tool_result",
            toolCallId: call.id,
            content: toolResult.content,
            isError: toolResult.isError,
          });

          results.push(
            toolResultPart(call.id, toolResult.content, toolResult.isError),
          );
        }

        messages.push(toolMessage(results));
      }

      await emit({ type: "done", messages });
      return {
        messages,
        text: lastAssistantText(messages),
        turns,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.opts.hooks.emitError({ messages, turn: turns, signal, error });
      await emit({ type: "error", error });
      throw error;
    }
  }

  private async completeTurn(
    req: {
      messages: Message[];
      tools?: import("./types.js").ToolDefinition[];
      system?: string;
      maxTokens?: number;
      signal?: AbortSignal;
    },
    emit: (event: RunEvent) => Promise<void>,
  ): Promise<import("./types.js").CompletionResult> {
    const stream = this.opts.provider.stream;
    if (!stream) {
      const result = await this.opts.provider.complete(req);
      for (const part of result.message.content) {
        if (part.type === "text" && part.text) {
          await emit({ type: "text_delta", text: part.text });
        }
      }
      return result;
    }

    let final: import("./types.js").CompletionResult | undefined;
    try {
      for await (const chunk of stream.call(this.opts.provider, req)) {
        if (req.signal?.aborted) {
          throw new DOMException("Run aborted", "AbortError");
        }
        if (chunk.type === "text_delta" && chunk.text) {
          await emit({ type: "text_delta", text: chunk.text });
        } else if (chunk.type === "done" && chunk.result) {
          final = chunk.result;
        }
      }
    } catch (err) {
      if (req.signal?.aborted || isAbortLike(err)) {
        throw new DOMException("Run aborted", "AbortError");
      }
      throw err;
    }
    if (req.signal?.aborted) {
      throw new DOMException("Run aborted", "AbortError");
    }
    if (!final) {
      throw new Error("Provider stream ended without a result");
    }
    return final;
  }

  private async resolvePermission(
    input: RunInput,
    ctx: {
      toolCall: import("./types.js").ToolCallPart;
      messages: Message[];
      turn: number;
      signal?: AbortSignal;
    },
  ): Promise<{ ok: true; reason?: string } | { ok: false; reason: string }> {
    const handler = this.opts.permissionHandler;
    if (!handler) return { ok: true };

    const decision = await handler(ctx);
    if (decision.action === "allow") {
      return { ok: true };
    }
    if (decision.action === "deny") {
      return { ok: false, reason: decision.reason };
    }

    // ask
    await input.onEvent?.({
      type: "permission",
      toolCall: ctx.toolCall,
      decision: "ask",
      reason: decision.reason,
    });

    if (!input.onPermissionAsk) {
      return {
        ok: false,
        reason: `${decision.reason} (no interactive approver; pass onPermissionAsk or --yes)`,
      };
    }

    const answer = await input.onPermissionAsk({
      toolCall: ctx.toolCall,
      reason: decision.reason,
      grantRoot: decision.grantRoot,
    });

    if (answer === "deny") {
      return { ok: false, reason: decision.reason };
    }

    // allow | allow_session — grants (tool / root) are applied by the ask callback
    return { ok: true, reason: decision.reason };
  }
}
