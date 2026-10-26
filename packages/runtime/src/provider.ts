import type { ModelProvider } from "@min-agent/core";
import { createProvider, importProviderModules } from "@min-agent/providers";

export function resolveProvider(opts: {
  provider?: string;
  model?: string;
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

  return createProvider(kind, { model: opts.model });
}

/**
 * Load `MIN_PROVIDER_MODULE` (comma-separated package names or file paths).
 * Each module should call `registerProvider`. Call this before `resolveProvider`
 * when a host wants ids that are not built in.
 */
export async function loadProviderExtensions(): Promise<void> {
  await importProviderModules();
}
