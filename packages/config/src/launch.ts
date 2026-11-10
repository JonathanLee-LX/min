import type { ProviderSpec, ResolvedMinConfig } from "./types.js";

export interface ProviderLaunchSpec {
  kind?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  maxContextTokens?: number;
}

/**
 * Resolve the provider to start with.
 * A `providers.json` (or imported) name wins over treating `provider` as a kind.
 */
export function providerLaunchSpec(config: ResolvedMinConfig): ProviderLaunchSpec {
  const named = config.provider ? config.providers[config.provider] : undefined;
  if (named) return fromNamed(named, config.model);
  return {
    ...(config.provider ? { kind: config.provider } : {}),
    ...(config.model ? { model: config.model } : {}),
  };
}

function fromNamed(spec: ProviderSpec, fallbackModel?: string): ProviderLaunchSpec {
  const model = spec.model ?? fallbackModel;
  return {
    kind: spec.kind,
    ...(model ? { model } : {}),
    ...(spec.baseUrl ? { baseUrl: spec.baseUrl } : {}),
    ...(spec.apiKeyEnv ? { apiKeyEnv: spec.apiKeyEnv } : {}),
    ...(spec.maxContextTokens ? { maxContextTokens: spec.maxContextTokens } : {}),
  };
}
