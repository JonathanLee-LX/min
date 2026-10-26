import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { JsonSchema, Message, ToolDefinition } from "./types.js";

export interface ToolContext {
  signal?: AbortSignal;
  /** Opaque bag for extensions / callers. */
  extras?: Record<string, unknown>;
  /** Set by the Runner for the model tool call being executed. */
  toolCallId?: string;
  /** 1-based model turn that issued this call. */
  turn?: number;
  /**
   * Canonical messages so far, including the assistant message that issued
   * the call. A shallow copy; not the projected model view.
   */
  messages?: readonly Message[];
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface Tool<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  execute(input: TInput, ctx: ToolContext): Promise<ToolResult>;
}

export function defineTool<TInput>(tool: Tool<TInput>): Tool<TInput> {
  return tool;
}

export function toolToDefinition(tool: Tool): ToolDefinition {
  const schema = zodToJsonSchema(tool.inputSchema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as JsonSchema;

  // Strip meta that models don't need
  const { $schema, ...rest } = schema;

  return {
    name: tool.name,
    description: tool.description,
    inputSchema: rest,
  };
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  definitions(): ToolDefinition[] {
    return this.list().map(toolToDefinition);
  }

  async execute(
    name: string,
    rawInput: unknown,
    ctx: ToolContext = {},
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }

    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        content: `Invalid arguments for ${name}: ${parsed.error.message}`,
        isError: true,
      };
    }

    try {
      return await tool.execute(parsed.data, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: message, isError: true };
    }
  }
}
