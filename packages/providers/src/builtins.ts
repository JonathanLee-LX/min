import { mockProvider } from "@min/core";
import { anthropicProvider } from "./anthropic.js";
import { deepseekProvider } from "./deepseek.js";
import { openaiChatProvider } from "./openai-chat.js";
import { openaiProvider } from "./openai.js";
import { registerProvider } from "./registry.js";

registerProvider("mock", () =>
  mockProvider([
    {
      text: "I'll list the workspace.",
      toolCalls: [{ name: "glob", arguments: { dir: ".", limit: 20 } }],
    },
    { text: "Done (mock provider). Set DEEPSEEK_API_KEY for a real model." },
  ]),
);

registerProvider("openai", (opts) =>
  openaiProvider({
    apiKey: opts.apiKey,
    model: opts.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1",
    baseURL: opts.baseURL,
    maxTokens: opts.maxTokens,
  }),
);

registerProvider("openai-chat", (opts) =>
  openaiChatProvider({
    apiKey: opts.apiKey,
    model: opts.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1",
    baseURL: opts.baseURL,
    maxTokens: opts.maxTokens,
    id: "openai-chat",
  }),
);

registerProvider("anthropic", (opts) =>
  anthropicProvider({
    apiKey: opts.apiKey,
    model: opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    baseURL: opts.baseURL,
    maxTokens: opts.maxTokens,
  }),
);

registerProvider("deepseek", (opts) => {
  const api =
    opts.api ??
    (process.env.DEEPSEEK_API === "chat" ? "chat" : "responses");
  const model =
    opts.model ??
    process.env.DEEPSEEK_MODEL ??
    (api === "chat" ? "deepseek-chat" : "deepseek-flash");
  return deepseekProvider({
    apiKey: opts.apiKey,
    api,
    model,
    baseURL: opts.baseURL,
    maxTokens: opts.maxTokens,
  });
});
