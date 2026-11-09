import { parseReasoningEffort, type ModelProvider, type ReasoningEffort } from "@min-agent/core";
import { importProviderModules, tunableProvider } from "@min-agent/providers";

export function resolveProvider(opts: {
  provider?: string;
  model?: string;
  /** `none` | `low` | `medium` | `high` | `max`. Unknown strings are ignored. */
  reasoningEffort?: ReasoningEffort | string;
  baseURL?: string;
  apiKey?: string;
}): ModelProvider {
  const kind =
    opts.provider ??
    process.env.PROVIDER ??
    (process.env.DEEPSEEK_API_KEY
      ? "deepseek"
      : process.env.OPENAI_API_KEY
        ? "openai"
        : process.env.ANTHROPIC_API_KEY
          ? "anthropic"
          : "mock");

  const effort =
    typeof opts.reasoningEffort === "string"
      ? parseReasoningEffort(opts.reasoningEffort)
      : opts.reasoningEffort;

  return tunableProvider({
    kind,
    model: opts.model,
    reasoningEffort: effort,
    baseURL: opts.baseURL,
    apiKey: opts.apiKey,
  });
}

/**
 * Load `MIN_PROVIDER_MODULE` (comma-separated package names or file paths).
 * Each module should call `registerProvider`. Call this before `resolveProvider`
 * when a host wants ids that are not built in.
 */
export async function loadProviderExtensions(): Promise<void> {
  await importProviderModules();
}
