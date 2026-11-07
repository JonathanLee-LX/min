export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.max(0, Math.round(tokens)));
  if (tokens < 10_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.round(tokens / 1000)}k`;
}

export function contextPercent(used: number, limit: number, ratio: number): string {
  const pct = Math.max(0, Math.round(ratio * 100));
  return `${formatTokens(used)}/${formatTokens(limit)} ${pct}%`;
}
