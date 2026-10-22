import { HookBus } from "./extension.js";
import {
  lastAssistantText,
  messageToolCalls,
  toolMessage,
  toolResultPart,
  userMessage,
} from "./messages.js";
import type { ModelProvider } from "./provider.js";
import type { ToolRegistry } from "./tools.js";
import type { Message, RunEvent, RunInput, RunResult } from "./types.js";

export interface RunnerOptions {
  provider: ModelProvider;
  tools: ToolRegistry;
  hooks: HookBus;
  /** Static system prompt, or a getter so extensions can append mid-run. */
  system?: string | (() => string | undefined);
  maxTurns?: number;
  maxTokens?: number;
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
        const result = await this.opts.provider.complete({
          messages,
          tools: toolDefs.length ? toolDefs : undefined,
          system,
          maxTokens: this.opts.maxTokens,
          signal,
        });

        messages.push(result.message);
        await this.opts.hooks.emitAfterTurn({ ...hookCtx, message: result.message });
        await emit({ type: "turn_end", turn: turns, message: result.message });

        for (const part of result.message.content) {
          if (part.type === "text" && part.text) {
            await emit({ type: "text_delta", text: part.text });
          }
        }

        const toolCalls = messageToolCalls(result.message);
        if (!toolCalls.length || result.stopReason === "end") {
          break;
        }

        const results = [];
        for (const call of toolCalls) {
          await emit({ type: "tool_call", toolCall: call });
          await this.opts.hooks.emitBeforeTool({ ...hookCtx, toolCall: call });

          const toolResult = await this.opts.tools.execute(call.name, call.arguments, {
            signal,
          });

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
}
