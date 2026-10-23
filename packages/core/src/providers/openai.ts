import OpenAI from "openai";
import type {
  EasyInputMessage,
  FunctionTool,
  Response,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem,
  Tool,
} from "openai/resources/responses/responses";
import type { ModelProvider } from "../provider.js";
import type {
  CompletionChunk,
  CompletionRequest,
  CompletionResult,
  ContentPart,
  Message,
  ToolDefinition,
} from "../types.js";

export interface OpenAIProviderOptions {
  apiKey?: string;
  model: string;
  baseURL?: string;
  maxTokens?: number;
  /** Injected client for tests. */
  client?: OpenAI;
}

export function openaiProvider(opts: OpenAIProviderOptions): ModelProvider {
  const client =
    opts.client ??
    new OpenAI({
      apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: opts.baseURL,
    });
  const defaultMaxTokens = opts.maxTokens ?? 4096;

  return {
    id: `openai:${opts.model}`,

    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const { instructions, input } = toResponsesInput(req);

      const response = await client.responses.create(
        {
          model: opts.model,
          input,
          ...(instructions ? { instructions } : {}),
          ...(req.tools?.length
            ? { tools: toOpenAITools(req.tools) }
            : {}),
          max_output_tokens: req.maxTokens ?? defaultMaxTokens,
          store: false,
        },
        { signal: req.signal },
      );

      return fromResponsesOutput(response);
    },

    async *stream(req: CompletionRequest): AsyncIterable<CompletionChunk> {
      const { instructions, input } = toResponsesInput(req);

      const stream = await client.responses.create(
        {
          model: opts.model,
          input,
          ...(instructions ? { instructions } : {}),
          ...(req.tools?.length
            ? { tools: toOpenAITools(req.tools) }
            : {}),
          max_output_tokens: req.maxTokens ?? defaultMaxTokens,
          store: false,
          stream: true,
        },
        { signal: req.signal },
      );

      for await (const event of stream) {
        if (event.type === "response.output_text.delta" && event.delta) {
          yield { type: "text_delta", text: event.delta };
        } else if (event.type === "response.completed") {
          yield {
            type: "done",
            result: fromResponsesOutput(event.response),
          };
        } else if (event.type === "response.failed") {
          const msg =
            event.response.error?.message ?? "Responses API request failed";
          throw new Error(msg);
        }
      }
    },
  };
}

function toOpenAITools(tools: ToolDefinition[]): Tool[] {
  return tools.map(
    (t): FunctionTool => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as FunctionTool["parameters"],
      strict: false,
    }),
  );
}

function toResponsesInput(req: CompletionRequest): {
  instructions?: string;
  input: ResponseInputItem[];
} {
  const instructionParts: string[] = [];
  if (req.system) instructionParts.push(req.system);

  const input: ResponseInputItem[] = [];

  for (const msg of req.messages) {
    if (msg.role === "system") {
      for (const part of msg.content) {
        if (part.type === "text") instructionParts.push(part.text);
      }
      continue;
    }

    if (msg.role === "user") {
      const text = msg.content
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("");
      const easy: EasyInputMessage = { role: "user", content: text };
      input.push(easy);
      continue;
    }

    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          input.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: part.text }],
          } as ResponseInputItem);
        } else if (part.type === "tool_call") {
          input.push({
            type: "function_call",
            call_id: part.id,
            name: part.name,
            arguments: JSON.stringify(part.arguments),
          });
        }
      }
      continue;
    }

    if (msg.role === "tool") {
      for (const part of msg.content) {
        if (part.type === "tool_result") {
          input.push({
            type: "function_call_output",
            call_id: part.toolCallId,
            output: part.content,
          });
        }
      }
    }
  }

  return {
    instructions: instructionParts.length
      ? instructionParts.join("\n\n")
      : undefined,
    input,
  };
}

function fromResponsesOutput(response: Response): CompletionResult {
  const content: ContentPart[] = [];
  let hasToolCall = false;

  for (const item of response.output as ResponseOutputItem[]) {
    if (item.type === "message") {
      for (const part of item.content) {
        if (part.type === "output_text") {
          content.push({ type: "text", text: part.text });
        }
      }
    } else if (item.type === "function_call") {
      hasToolCall = true;
      const call = item as ResponseFunctionToolCall;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = { _raw: call.arguments };
      }
      content.push({
        type: "tool_call",
        id: call.call_id,
        name: call.name,
        arguments: args,
      });
    }
  }

  // Fallback to convenience helper when output is empty but output_text exists
  if (!content.length && response.output_text) {
    content.push({ type: "text", text: response.output_text });
  }

  const stopReason =
    response.status === "incomplete"
      ? "length"
      : hasToolCall
        ? "tool_use"
        : "end";

  return {
    message: { role: "assistant", content },
    stopReason,
    usage: {
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    },
  };
}

// Silence unused Message import warning path for documentation
export type { Message };
