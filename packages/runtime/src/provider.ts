import {
  anthropicProvider,
  deepseekProvider,
  mockProvider,
  openaiProvider,
  type ModelProvider,
} from "@min/core";

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

  if (kind === "deepseek") {
    const api =
      process.env.DEEPSEEK_API === "chat"
        ? ("chat" as const)
        : ("responses" as const);
    return deepseekProvider({
      api,
      model:
        opts.model ??
        process.env.DEEPSEEK_MODEL ??
        (api === "chat" ? "deepseek-chat" : "deepseek-flash"),
    });
  }

  if (kind === "openai") {
    return openaiProvider({
      model: opts.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1",
    });
  }

  if (kind === "anthropic") {
    return anthropicProvider({
      model: opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    });
  }

  if (kind === "mock") {
    return mockProvider([
      {
        text: "I'll list the workspace.",
        toolCalls: [{ name: "glob", arguments: { dir: ".", limit: 20 } }],
      },
      { text: "Done (mock provider). Set DEEPSEEK_API_KEY for a real model." },
    ]);
  }

  throw new Error(`Unknown provider: ${kind}`);
}
