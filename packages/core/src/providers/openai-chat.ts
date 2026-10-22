import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { ModelProvider } from "../provider.js";
import type {
  CompletionRequest,
  CompletionResult,
  ContentPart,
  Message,
  ToolDefinition,
} from "../types.js";

export interface OpenAIChatProviderOptions {
  apiKey?: string;
  model: string;
  baseURL?: string;
  maxTokens?: number;
  /** Provider id prefix, e.g. "deepseek" or "openai-chat". */
  id?: string;
  /** Injected client for tests. */
  client?: OpenAI;
}

/**
 * OpenAI Chat Completions adapter — for OpenAI and compatible hosts
 * (DeepSeek, Groq, local gateways, etc.) that do not expose Responses API.
 */
export function openaiChatProvider(
  opts: OpenAIChatProviderOptions,
): ModelProvider {
  const client =
    opts.client ??
    new OpenAI({
      apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: opts.baseURL,
    });
  const defaultMaxTokens = opts.maxTokens ?? 4096;
  const prefix = opts.id ?? "openai-chat";

  return {
    id: `${prefix}:${opts.model}`,

    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const messages = toChatMessages(req);

      const response = await client.chat.completions.create(
        {
          model: opts.model,
          messages,
          max_tokens: req.maxTokens ?? defaultMaxTokens,
          ...(req.tools?.length
            ? {
                tools: toChatTools(req.tools),
                tool_choice: "auto" as const,
              }
            : {}),
        },
        { signal: req.signal },
      );

      const choice = response.choices[0];
      if (!choice) {
        return {
          message: { role: "assistant", content: [] },
          stopReason: "error",
        };
      }

      const content: ContentPart[] = [];
      if (choice.message.content) {
        content.push({ type: "text", text: choice.message.content });
      }
      for (const call of choice.message.tool_calls ?? []) {
        if (call.type !== "function") continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<
            string,
            unknown
          >;
        } catch {
          args = { _raw: call.function.arguments };
        }
        content.push({
          type: "tool_call",
          id: call.id,
          name: call.function.name,
          arguments: args,
        });
      }

      const stopReason =
        choice.finish_reason === "tool_calls"
          ? "tool_use"
          : choice.finish_reason === "length"
            ? "length"
            : "end";

      return {
        message: { role: "assistant", content },
        stopReason,
        usage: {
          inputTokens: response.usage?.prompt_tokens,
          outputTokens: response.usage?.completion_tokens,
        },
      };
    },
  };
}

/** Convenience: DeepSeek via OpenAI-compatible Chat Completions. */
export function deepseekProvider(
  opts: Omit<OpenAIChatProviderOptions, "baseURL" | "id" | "model"> & {
    baseURL?: string;
    model?: string;
  } = {},
): ModelProvider {
  return openaiChatProvider({
    ...opts,
    id: "deepseek",
    baseURL: opts.baseURL ?? "https://api.deepseek.com",
    apiKey:
      opts.apiKey ??
      process.env.DEEPSEEK_API_KEY ??
      process.env.OPENAI_API_KEY,
    model: opts.model ?? "deepseek-chat",
  });
}

function toChatTools(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

function toChatMessages(req: CompletionRequest): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [];

  if (req.system) {
    out.push({ role: "system", content: req.system });
  }

  for (const msg of req.messages) {
    appendMessage(out, msg);
  }

  return out;
}

function appendMessage(
  out: ChatCompletionMessageParam[],
  msg: Message,
): void {
  if (msg.role === "system") {
    const text = msg.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n");
    if (text) out.push({ role: "system", content: text });
    return;
  }

  if (msg.role === "user") {
    const text = msg.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("");
    out.push({ role: "user", content: text });
    return;
  }

  if (msg.role === "assistant") {
    const textParts = msg.content.filter((p) => p.type === "text");
    const toolCalls = msg.content.filter((p) => p.type === "tool_call");
    const text = textParts
      .map((p) => (p as { text: string }).text)
      .join("");

    if (toolCalls.length) {
      out.push({
        role: "assistant",
        content: text || null,
        tool_calls: toolCalls.map((p) => {
          const call = p as {
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          };
          return {
            id: call.id,
            type: "function" as const,
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments ?? {}),
            },
          };
        }),
      });
    } else {
      out.push({ role: "assistant", content: text });
    }
    return;
  }

  if (msg.role === "tool") {
    for (const part of msg.content) {
      if (part.type === "tool_result") {
        out.push({
          role: "tool",
          tool_call_id: part.toolCallId,
          content: part.content,
        });
      }
    }
  }
}
