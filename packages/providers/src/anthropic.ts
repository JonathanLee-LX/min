import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  ThinkingConfigParam,
  Tool as AnthropicTool,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { ModelProvider, ReasoningEffort } from "@min-agent/core";
import type {
  CompletionRequest,
  CompletionResult,
  ContentPart,
  Message,
  ToolDefinition,
} from "@min-agent/core";
import { bytesToBase64, requireMediaData } from "./media.js";

export interface AnthropicProviderOptions {
  apiKey?: string;
  model: string;
  baseURL?: string;
  maxTokens?: number;
  /**
   * Extended-thinking budget. `none` disables it.
   * Omit to leave thinking off, which is the previous default.
   */
  reasoningEffort?: ReasoningEffort;
  /** Injected client for tests. */
  client?: Anthropic;
}

export function anthropicProvider(opts: AnthropicProviderOptions): ModelProvider {
  const client =
    opts.client ??
    new Anthropic({
      apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
      baseURL: opts.baseURL,
    });
  const defaultMaxTokens = opts.maxTokens ?? 4096;

  return {
    id: `anthropic:${opts.model}`,

    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const { system, messages } = splitSystem(req);
      const thinking = anthropicThinking(opts.reasoningEffort, req.maxTokens ?? defaultMaxTokens);
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: opts.model,
        max_tokens: thinking.max_tokens,
        messages: toAnthropicMessages(messages),
        ...(system ? { system } : {}),
        ...(req.tools?.length ? { tools: toAnthropicTools(req.tools) } : {}),
        ...(thinking.thinking ? { thinking: thinking.thinking } : {}),
      };

      const response = await client.messages.create(params, {
        signal: req.signal,
      });

      const content = fromAnthropicContent(response.content);
      const stopReason =
        response.stop_reason === "tool_use"
          ? "tool_use"
          : response.stop_reason === "max_tokens"
            ? "length"
            : "end";

      return {
        message: { role: "assistant", content },
        stopReason,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
}

const THINKING_BUDGET = {
  low: 1024,
  medium: 4096,
  high: 8192,
  max: 16384,
} as const;

/** Map a shared effort name onto Claude's extended-thinking budget. */
function anthropicThinking(
  effort: ReasoningEffort | undefined,
  maxTokens: number,
): { max_tokens: number; thinking?: ThinkingConfigParam } {
  if (!effort) return { max_tokens: maxTokens };
  if (effort === "none") return { max_tokens: maxTokens, thinking: { type: "disabled" } };
  const budget = THINKING_BUDGET[effort];
  return {
    max_tokens: Math.max(maxTokens, budget + 1024),
    thinking: { type: "enabled", budget_tokens: budget },
  };
}

function splitSystem(req: CompletionRequest): {
  system?: string;
  messages: Message[];
} {
  const systemParts: string[] = [];
  if (req.system) systemParts.push(req.system);

  const messages: Message[] = [];
  for (const msg of req.messages) {
    if (msg.role === "system") {
      for (const part of msg.content) {
        if (part.type === "text") systemParts.push(part.text);
      }
    } else {
      messages.push(msg);
    }
  }

  return {
    system: systemParts.length ? systemParts.join("\n\n") : undefined,
    messages,
  };
}

function toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as AnthropicTool["input_schema"],
  }));
}

function toAnthropicMessages(messages: Message[]): MessageParam[] {
  const out: MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const content: ContentBlockParam[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          content.push({ type: "text", text: part.text });
        } else if (part.type === "image") {
          const data = requireMediaData(part);
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: part.mediaType,
              data: bytesToBase64(data),
            },
          });
        } else if (part.type === "document") {
          const data = requireMediaData(part);
          content.push({
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: bytesToBase64(data),
            },
          });
        }
      }
      out.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      const content: ContentBlockParam[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          content.push({ type: "text", text: part.text });
        } else if (part.type === "tool_call") {
          content.push({
            type: "tool_use",
            id: part.id,
            name: part.name,
            input: part.arguments,
          });
        }
      }
      out.push({ role: "assistant", content });
    } else if (msg.role === "tool") {
      const content: ToolResultBlockParam[] = msg.content
        .filter((p) => p.type === "tool_result")
        .map((p) => ({
          type: "tool_result" as const,
          tool_use_id: (p as { toolCallId: string }).toolCallId,
          content: (p as { content: string }).content,
          is_error: (p as { isError?: boolean }).isError,
        }));
      // Anthropic expects tool results as a user message
      out.push({ role: "user", content });
    }
  }

  return mergeAdjacentUserMessages(out);
}

/** Anthropic rejects consecutive same-role messages; merge adjacent users. */
function mergeAdjacentUserMessages(messages: MessageParam[]): MessageParam[] {
  const merged: MessageParam[] = [];
  for (const msg of messages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === "user" && msg.role === "user") {
      const prevContent = Array.isArray(prev.content)
        ? prev.content
        : [{ type: "text" as const, text: String(prev.content) }];
      const nextContent = Array.isArray(msg.content)
        ? msg.content
        : [{ type: "text" as const, text: String(msg.content) }];
      prev.content = [...prevContent, ...nextContent] as ContentBlockParam[];
    } else {
      merged.push(msg);
    }
  }
  return merged;
}

function fromAnthropicContent(blocks: ContentBlock[]): ContentPart[] {
  const parts: ContentPart[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      const use = block as ToolUseBlock;
      parts.push({
        type: "tool_call",
        id: use.id,
        name: use.name,
        arguments: (use.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  return parts;
}
