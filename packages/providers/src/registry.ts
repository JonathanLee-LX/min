import type { ModelProvider } from "@min/core";

/**
 * Options passed to a registered provider factory.
 * Factories may ignore fields they do not use.
 */
export interface ProviderOptions {
  model?: string;
  apiKey?: string;
  baseURL?: string;
  maxTokens?: number;
  /** DeepSeek / OpenAI-compatible protocol. */
  api?: "responses" | "chat";
}

export type ProviderFactory = (opts: ProviderOptions) => ModelProvider;

const factories = new Map<string, ProviderFactory>();

/** Register or replace a provider by id. Does not modify @min/core. */
export function registerProvider(id: string, factory: ProviderFactory): void {
  const name = id.trim();
  if (!name) throw new Error("Provider id is required");
  factories.set(name, factory);
}

export function unregisterProvider(id: string): void {
  factories.delete(id);
}

export function listProviders(): string[] {
  return [...factories.keys()].sort();
}

export function hasProvider(id: string): boolean {
  return factories.has(id);
}

/** Build a provider by registered id. */
export function createProvider(
  id: string,
  opts: ProviderOptions = {},
): ModelProvider {
  const factory = factories.get(id);
  if (!factory) {
    const known = listProviders().join(", ") || "(none)";
    throw new Error(`Unknown provider: ${id}. Registered: ${known}`);
  }
  return factory(opts);
}

/**
 * Import modules that call `registerProvider`.
 * `MIN_PROVIDER_MODULE` is a comma-separated list of package names or file paths.
 */
export async function importProviderModules(spec?: string): Promise<void> {
  const raw = spec ?? process.env.MIN_PROVIDER_MODULE;
  if (!raw?.trim()) return;
  const path = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  for (const part of raw.split(",")) {
    const mod = part.trim();
    if (!mod) continue;
    if (
      mod.startsWith(".") ||
      mod.startsWith("/") ||
      mod.startsWith("file:")
    ) {
      const href = mod.startsWith("file:")
        ? mod
        : pathToFileURL(path.resolve(mod)).href;
      await import(href);
    } else {
      await import(mod);
    }
  }
}
