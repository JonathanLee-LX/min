/** Suggested model ids for `/model`. Any other id can still be set. */
const SUGGESTED: Readonly<Record<string, readonly string[]>> = {
  openai: ["gpt-4.1", "gpt-4.1-mini", "o3", "o4-mini"],
  "openai-chat": ["gpt-4.1", "gpt-4.1-mini"],
  deepseek: ["deepseek-flash", "deepseek-v4-pro", "deepseek-chat"],
  anthropic: ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
};

/** Current model first when it is not already in the built-in list. */
export function modelsFor(kind: string, current?: string): string[] {
  const suggested = SUGGESTED[kind] ?? [];
  if (!current || suggested.includes(current)) return [...suggested];
  return [current, ...suggested];
}
