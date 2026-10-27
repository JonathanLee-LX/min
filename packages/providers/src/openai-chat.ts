import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { ModelProvider } from "@min-agent/core";
import type {
  CompletionChunk,
  CompletionRequest,
  CompletionResult,
  ContentPart,
  Message,
  ToolDefinition,
} from "@min-agent/core";

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

    async *stream(req: CompletionRequest): AsyncIterable<CompletionChunk> {
      const messages = toChatMessages(req);

      const stream = await client.chat.completions.create(
        {
          model: opts.model,
          messages,
          max_tokens: req.maxTokens ?? defaultMaxTokens,
          stream: true,
          ...(req.tools?.length
            ? {
                tools: toChatTools(req.tools),
                tool_choice: "auto" as const,
              }
            : {}),
        },
        { signal: req.signal },
      );

      let text = "";
      const toolAcc = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      let finishReason: string | null | undefined;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;
        finishReason = choice.finish_reason ?? finishReason;

        const delta = choice.delta;
        const reasoning = chatReasoningDelta(delta);
        if (reasoning) {
          yield { type: "thinking_delta", text: reasoning };
        }
        if (delta?.content) {
          text += delta.content;
          yield { type: "text_delta", text: delta.content };
        }

        for (const tc of delta?.tool_calls ?? []) {
          const prev = toolAcc.get(tc.index) ?? {
            id: "",
            name: "",
            arguments: "",
          };
          if (tc.id) prev.id = tc.id;
          if (tc.function?.name) prev.name += tc.function.name;
          if (tc.function?.arguments) prev.arguments += tc.function.arguments;
          toolAcc.set(tc.index, prev);
        }
      }

      const content: ContentPart[] = [];
      if (text) content.push({ type: "text", text });
      for (const [, call] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = { _raw: call.arguments };
        }
        content.push({
          type: "tool_call",
          id: call.id || `call_${call.name}`,
          name: call.name,
          arguments: args,
        });
      }

      const stopReason =
        finishReason === "tool_calls"
          ? "tool_use"
          : finishReason === "length"
            ? "length"
            : "end";

      yield {
        type: "done",
        result: {
          message: { role: "assistant", content },
          stopReason,
        },
      };
    },
  };
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

/** DeepSeek / compatible hosts stream CoT on `reasoning_content`. */
function chatReasoningDelta(delta: unknown): string | null {
  if (!delta || typeof delta !== "object") return null;
  const record = delta as Record<string, unknown>;
  for (const key of ["reasoning_content", "reasoning", "reasoning_text"]) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}
