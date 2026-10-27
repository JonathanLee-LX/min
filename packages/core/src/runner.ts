import {
  lastAssistantText,
  messageToolCalls,
  toolMessage,
  toolResultPart,
  userMessage,
} from "./messages.js";
import type { ModelProvider } from "./provider.js";
import type { ToolRegistry } from "./tools.js";
import type { CompletionResult, Message, RunEvent, RunInput, RunResult, ToolDefinition } from "./types.js";

function isAbortLike(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return e.name === "AbortError" || /aborted|abort/i.test(e.message ?? "");
}

export interface RunnerOptions {
  provider: ModelProvider;
  tools: ToolRegistry;
  /** Static system prompt, or a getter re-read before every completion. */
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
        await emit({ type: "turn_start", turn: turns });

        const toolDefs = this.opts.tools.definitions();
        const system =
          typeof this.opts.system === "function"
            ? this.opts.system()
            : this.opts.system;
        const completionReq = {
          messages,
          tools: toolDefs.length ? toolDefs : undefined,
          system,
          maxTokens: this.opts.maxTokens,
          signal,
        };
        const result = await this.completeTurn(completionReq, emit);

        messages.push(result.message);
        await emit({ type: "turn_end", turn: turns, message: result.message });

        const toolCalls = messageToolCalls(result.message);
        if (!toolCalls.length || result.stopReason === "end") {
          break;
        }

        const results = [];
        for (const call of toolCalls) {
          await emit({ type: "tool_call", toolCall: call });

          const toolResult = await this.opts.tools.execute(
            call.name,
            call.arguments,
            {
              signal,
              toolCallId: call.id,
              turn: turns,
              messages: [...messages],
            },
          );

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

      // Cap hit mid tool-loop: last message is tool results awaiting another complete.
      if (turns >= maxTurns && messages.at(-1)?.role === "tool") {
        await emit({
          type: "error",
          error: new Error(
            `Stopped after maxTurns=${maxTurns} (tool loop still pending). Raise with --max-turns / RuntimeOptions.maxTurns.`,
          ),
        });
      }

      await emit({ type: "done", messages });
      return {
        messages,
        text: lastAssistantText(messages),
        turns,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await emit({ type: "error", error });
      throw error;
    }
  }

  private async completeTurn(
    req: {
      messages: Message[];
      tools?: ToolDefinition[];
      system?: string;
      maxTokens?: number;
      signal?: AbortSignal;
    },
    emit: (event: RunEvent) => Promise<void>,
  ): Promise<CompletionResult> {
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

    let final: CompletionResult | undefined;
    try {
      for await (const chunk of stream.call(this.opts.provider, req)) {
        if (req.signal?.aborted) {
          throw new DOMException("Run aborted", "AbortError");
        }
        if (chunk.type === "text_delta" && chunk.text) {
          await emit({ type: "text_delta", text: chunk.text });
        } else if (chunk.type === "thinking_delta" && chunk.text) {
          await emit({ type: "thinking_delta", text: chunk.text });
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
}
