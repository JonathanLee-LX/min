import type OpenAI from "openai";
import type { ModelProvider } from "@min/core";
import { openaiChatProvider } from "./openai-chat.js";
import { openaiProvider } from "./openai.js";

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
    return openaiChatProvider({
      apiKey,
      model,
      baseURL,
      maxTokens,
      id: "deepseek",
      client: opts.client,
    });
  }

  const model = opts.model ?? "deepseek-flash";
  const inner = openaiProvider({
    apiKey,
    model,
    baseURL,
    maxTokens,
    client: opts.client,
  });
  return {
    id: `deepseek:${model}`,
    complete: (req) => inner.complete(req),
    stream: inner.stream?.bind(inner),
  };
}
