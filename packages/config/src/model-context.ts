import type { ProviderSpec } from "./types.js";

/** Same default as `@min-agent/session` — kept local to avoid a dependency. */
export const DEFAULT_MODEL_CONTEXT_TOKENS = 256_000;

export function modelIdFromProviderId(providerId: string): string {
  const colon = providerId.indexOf(":");
  return colon >= 0 ? providerId.slice(colon + 1) : providerId;
}

/**
 * Resolve the context window for a model.
 *
 * Precedence: CLI/host flag → per-model map → saved provider entry → global runtime default → 256k.
 */
export function effectiveMaxContextTokens(opts: {
  model: string;
  modelContextTokens?: Readonly<Record<string, number>>;
  providerSpec?: ProviderSpec;
  global?: number;
  flag?: number;
}): number {
  if (opts.flag !== undefined && opts.flag > 0) return opts.flag;
  const model = opts.model.trim();
  if (model && opts.modelContextTokens?.[model]) {
    return opts.modelContextTokens[model]!;
  }
  if (opts.providerSpec?.maxContextTokens) {
    return opts.providerSpec.maxContextTokens;
  }
  if (opts.global !== undefined && opts.global > 0) return opts.global;
  return DEFAULT_MODEL_CONTEXT_TOKENS;
}
