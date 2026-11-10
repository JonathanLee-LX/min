import type OpenAI from "openai";
import type { CompletionRequest, ModelProvider, ReasoningEffort } from "@min-agent/core";
import { openaiChatProvider } from "./openai-chat.js";
import { openaiProvider } from "./openai.js";
import { rejectMedia } from "./media.js";

export interface DeepSeekProviderOptions {
  apiKey?: string;
  /**
   * Responses API models: `deepseek-flash`, `deepseek-v4-pro`, …
   * Chat Completions also accepts legacy names like `deepseek-chat`.
   */
  model?: string;
  baseURL?: string;
  maxTokens?: number;
  /**
   * Protocol to use.
   * - `responses` (default): OpenAI Responses API — preferred for agents
   * - `chat`: OpenAI Chat Completions (legacy / broader gateway support)
   */
  api?: "responses" | "chat";
  /**
   * Responses thinking intensity. Default `high`.
   * `none` turns thinking off. Chat Completions receives the same value.
   */
  reasoningEffort?: ReasoningEffort;
  /** Injected client for tests. */
  client?: OpenAI;
}

const DEFAULT_BASE = "https://api.deepseek.com";

/**
 * DeepSeek provider.
 * Defaults to the OpenAI-compatible **Responses** API
 * (see https://api-docs.deepseek.com/guides/responses_api/).
 */
export function deepseekProvider(
  opts: DeepSeekProviderOptions = {},
): ModelProvider {
  const api = opts.api ?? "responses";
  const apiKey =
    opts.apiKey ??
    process.env.DEEPSEEK_API_KEY ??
    process.env.OPENAI_API_KEY;
  const baseURL = opts.baseURL ?? DEFAULT_BASE;
  const maxTokens = opts.maxTokens;

  if (api === "chat") {
    const model = opts.model ?? "deepseek-chat";
    return guardDeepseek(
      openaiChatProvider({
        apiKey,
        model,
        baseURL,
        maxTokens,
        id: "deepseek",
        reasoningEffort: opts.reasoningEffort,
        client: opts.client,
      }),
    );
  }

  const model = opts.model ?? "deepseek-flash";
  // DeepSeek thinking mode: CoT on response.reasoning_text.delta.
  // `summary` is accepted but never generated — use effort instead.
  const inner = openaiProvider({
    apiKey,
    model,
    baseURL,
    maxTokens,
    reasoningEffort: opts.reasoningEffort ?? "high",
    client: opts.client,
  });
  return guardDeepseek({
    id: `deepseek:${model}`,
    complete: (req) => inner.complete(req),
    stream: inner.stream?.bind(inner),
  });
}

function guardDeepseek(provider: ModelProvider): ModelProvider {
  const complete = async (req: CompletionRequest) => {
    rejectMedia(req.messages, "deepseek");
    return provider.complete(req);
  };
  return {
    id: provider.id,
    complete,
    stream: provider.stream
      ? async function* (req: CompletionRequest) {
          rejectMedia(req.messages, "deepseek");
          yield* provider.stream!(req);
        }
      : undefined,
  };
}
