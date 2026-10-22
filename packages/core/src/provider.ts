import type {
  CompletionChunk,
  CompletionRequest,
  CompletionResult,
} from "./types.js";

/**
 * Model backend. Adapters translate the internal message model
 * to Anthropic Messages / OpenAI Responses (or anything else).
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

  return {
    id,
    calls,
    async complete(req) {
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
    },
  };
}
