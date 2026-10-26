import type {
  CompletionChunk,
  CompletionRequest,
  CompletionResult,
} from "./types.js";

/**
 * Model backend. Core only defines this contract and {@link mockProvider}.
 * Built-in vendor adapters live in `@min/providers`; any object that
 * implements this interface can be passed to `createAgent`.
 */
export interface ModelProvider {
  readonly id: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  stream?(req: CompletionRequest): AsyncIterable<CompletionChunk>;
}

/** Simple mock provider for tests and offline examples. */
export interface MockTurn {
  /** Text reply, and/or tool calls to emit. */
  text?: string;
  toolCalls?: Array<{
    id?: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

export function mockProvider(
  turns: MockTurn[],
  id = "mock",
): ModelProvider & { calls: CompletionRequest[] } {
  let index = 0;
  const calls: CompletionRequest[] = [];

  const complete = async (req: CompletionRequest): Promise<CompletionResult> => {
    calls.push(req);
    const turn = turns[Math.min(index, turns.length - 1)];
    index += 1;
    if (!turn) {
      return {
        message: { role: "assistant", content: [{ type: "text", text: "" }] },
        stopReason: "end",
      };
    }

    const content: CompletionResult["message"]["content"] = [];
    if (turn.text) content.push({ type: "text", text: turn.text });
    for (const [i, call] of (turn.toolCalls ?? []).entries()) {
      content.push({
        type: "tool_call",
        id: call.id ?? `call_${index}_${i}`,
        name: call.name,
        arguments: call.arguments,
      });
    }

    return {
      message: { role: "assistant", content },
      stopReason: turn.toolCalls?.length ? "tool_use" : "end",
    };
  };

  return {
    id,
    calls,
    complete,
    async *stream(req) {
      const result = await complete(req);
      for (const part of result.message.content) {
        if (part.type === "text" && part.text) {
          // Split so CLI / runner stream tests see multiple deltas.
          const step = Math.max(1, Math.ceil(part.text.length / 3));
          for (let i = 0; i < part.text.length; i += step) {
            yield {
              type: "text_delta" as const,
              text: part.text.slice(i, i + step),
            };
          }
        }
      }
      yield { type: "done" as const, result };
    },
  };
}
