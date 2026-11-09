import type { MinClient } from "@min-agent/client";
import {
  effectiveMaxContextTokens,
  modelIdFromProviderId,
  type ProviderSpec,
  type ResolvedMinConfig,
} from "@min-agent/config";
import type { ModelControls } from "@min-agent/runtime";

export function syncModelContextBudget(
  client: MinClient,
  config: ResolvedMinConfig,
  controls: ModelControls,
  providerSpec?: ProviderSpec,
): number {
  const model =
    controls.selection().model ||
    modelIdFromProviderId(client.getStatus().provider) ||
    config.model ||
    "default";
  const tokens = effectiveMaxContextTokens({
    model,
    modelContextTokens: config.runtime.modelContextTokens,
    providerSpec,
    global: config.runtime.maxContextTokens,
  });
  client.setMaxContextTokens(tokens);
  return tokens;
}
