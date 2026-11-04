import type {
  CompletionChunk,
  CompletionRequest,
  ModelProvider,
  ReasoningEffort,
} from "@min-agent/core";
import "./builtins.js";
import { modelsFor } from "./catalog.js";
import { createProvider, hasProvider, listProviders } from "./registry.js";
import type { ProviderOptions } from "./registry.js";

export interface ModelSelection {
  kind: string;
  model: string;
  /** Set effort. Omit to keep the adapter default. */
  effort?: ReasoningEffort;
  baseURL?: string;
  api?: "responses" | "chat";
}

export interface ModelProviderChange {
  kind: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  api?: "responses" | "chat";
}

/**
 * Live model / effort handle. The Runner keeps the same provider object;
 * these methods rebuild the inner adapter for the next call.
 */
export interface ModelControls {
  selection(): ModelSelection;
  models(): readonly string[];
  setModel(model: string): void;
  setProvider(next: ModelProviderChange): void;
  setEffort(effort: ReasoningEffort | undefined): void;
}

export interface TunableProvider extends ModelProvider {
  readonly controls: ModelControls;
}

export function modelControls(provider: ModelProvider): ModelControls | undefined {
  const maybe = provider as ModelProvider & { controls?: ModelControls };
  return maybe.controls;
}

/**
 * One provider object whose kind, model, and thinking effort can change.
 * `id` follows the inner adapter, so status lines update after a switch.
 */
export function tunableProvider(initial: {
  kind: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  apiKey?: string;
  baseURL?: string;
  api?: "responses" | "chat";
  maxTokens?: number;
}): TunableProvider {
  let kind = initial.kind.trim();
  let model = initial.model?.trim() ?? "";
  let effort = initial.reasoningEffort;
  let apiKey = initial.apiKey;
  let baseURL = initial.baseURL;
  let api = initial.api;
  const maxTokens = initial.maxTokens;
  let inner = build();

  function build(): ModelProvider {
    const explicit = model;
    const opts: ProviderOptions = {
      ...(explicit ? { model: explicit } : {}),
      ...(effort ? { reasoningEffort: effort } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(baseURL ? { baseURL } : {}),
      ...(api ? { api } : {}),
      ...(maxTokens ? { maxTokens } : {}),
    };
    const next = createProvider(kind, opts);
    if (!explicit) {
      const colon = next.id.indexOf(":");
      const suffix = colon >= 0 ? next.id.slice(colon + 1) : "";
      if (suffix) model = suffix;
    }
    return next;
  }

  function rebuild(): void {
    inner = build();
  }

  const controls: ModelControls = {
    selection() {
      return {
        kind,
        model,
        ...(effort ? { effort } : {}),
        ...(baseURL ? { baseURL } : {}),
        ...(api ? { api } : {}),
      };
    },
    models() {
      return modelsFor(kind, model);
    },
    setModel(next) {
      const name = next.trim();
      if (!name) throw new Error("model name is empty");
      model = name;
      rebuild();
    },
    setProvider(next) {
      const name = next.kind.trim();
      if (!hasProvider(name)) {
        const known = listProviders().join(", ") || "(none)";
        throw new Error(`Unknown provider: ${name}. Registered: ${known}`);
      }
      kind = name;
      model = next.model?.trim() ?? "";
      apiKey = next.apiKey;
      baseURL = next.baseURL;
      api = next.api;
      rebuild();
    },
    setEffort(next) {
      effort = next;
      rebuild();
    },
  };

  // `stream` is a real method so the session can replace it with a projection.
  // The body reads `inner` on each call, including after that replacement
  // captured this function. Adapters without a stream (Anthropic) are adapted
  // here so a later switch still goes through the same projection.
  function stream(req: CompletionRequest): AsyncIterable<CompletionChunk> {
    const current = inner.stream;
    if (!current) return completeAsStream(inner, req);
    return current.call(inner, req);
  }

  return {
    get id() {
      return inner.id;
    },
    controls,
    complete(req) {
      return inner.complete(req);
    },
    stream,
  };
}

async function* completeAsStream(
  adapter: ModelProvider,
  req: CompletionRequest,
): AsyncIterable<CompletionChunk> {
  const result = await adapter.complete(req);
  for (const part of result.message.content) {
    if (part.type === "text" && part.text) {
      yield { type: "text_delta", text: part.text };
    }
  }
  yield { type: "done", result };
}
