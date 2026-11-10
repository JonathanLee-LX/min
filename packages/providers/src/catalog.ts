/** Suggested model ids for `/model`. Any other id can still be set. */
const SUGGESTED: Readonly<Record<string, readonly string[]>> = {
  openai: ["gpt-4.1", "gpt-4.1-mini", "o3", "o4-mini"],
  "openai-chat": ["gpt-4.1", "gpt-4.1-mini"],
  deepseek: ["deepseek-flash", "deepseek-v4-pro", "deepseek-chat"],
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
};

/** Providers whose adapters always accept a thinking-intensity setting. */
const EFFORT_KINDS = new Set(["deepseek", "anthropic"]);

/** Current model first when it is not already in the built-in list. */
export function modelsFor(kind: string, current?: string): string[] {
  const suggested = SUGGESTED[kind] ?? [];
  if (!current || suggested.includes(current)) return [...suggested];
  return [current, ...suggested];
}

/** Models that usually expose a reasoning summary over Responses. */
export function modelLikelyReasons(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m) return false;
  return (
    /^o[1-9]/.test(m) ||
    m.startsWith("gpt-5") ||
    m.includes("reason") ||
    m.startsWith("deepseek")
  );
}

/**
 * Whether `/model` can open a thinking-intensity submenu for this provider/model.
 * DeepSeek and Anthropic always expose effort. OpenAI-family only for reasoning models.
 */
export function modelSupportsEffort(kind: string, model?: string): boolean {
  const name = kind.trim().toLowerCase();
  if (EFFORT_KINDS.has(name)) return true;
  if (name === "openai" || name === "openai-chat") {
    return modelLikelyReasons(model ?? "");
  }
  return false;
}

/**
 * Built-in vision support. Unknown custom kinds return true so a BYOK
 * vision model is not blocked here; the host can still reject.
 */
export function modelSupportsImage(kind: string, _model?: string): boolean {
  const name = kind.trim().toLowerCase();
  if (name === "anthropic" || name === "openai" || name === "openai-chat") {
    return true;
  }
  if (name === "deepseek" || name === "mock") return false;
  return true;
}

/** PDF user parts. Chat Completions has no document field. */
export function modelSupportsPdf(kind: string, _model?: string): boolean {
  const name = kind.trim().toLowerCase();
  if (name === "anthropic" || name === "openai") return true;
  if (name === "openai-chat" || name === "deepseek" || name === "mock") {
    return false;
  }
  return true;
}
