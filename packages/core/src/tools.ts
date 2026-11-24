import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { isRecordedDuration } from "./messages.js";
import type { JsonSchema, Message, ToolDefinition } from "./types.js";

/**
 * Display clock for one tool body.
 * A wrapper that still has to wait for permission calls `claim` immediately,
 * then `start` when the body clock starts. The registry calls `start` itself
 * when nobody claims. This is not stored.
 */
export interface BodyClock {
  claim(): void;
  start(): void;
}

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
  /**
   * Live display clock. Not written to the session.
   * See {@link BodyClock}.
   */
  onBodyStart?: BodyClock;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  /**
   * Milliseconds spent inside the tool body.
   * Set by the registry or the permission gate. A gate measurement wins so
   * confirmation time is not substituted later.
   */
  durationMs?: number;
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

    const started = performance.now();
    const clock = ctx.onBodyStart;
    let claimed = false;
    const child: ToolContext = {
      ...ctx,
      onBodyStart: clock
        ? {
            claim() {
              claimed = true;
            },
            start() {
              clock.start();
            },
          }
        : undefined,
    };
    try {
      const pending = tool.execute(parsed.data, child);
      // Ungated tools never claim. Announce before awaiting the body.
      // A permission gate claims synchronously, then starts the clock later.
      if (!claimed) clock?.start();
      const result = await pending;
      return keepToolDuration(result, started);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: message, isError: true, durationMs: elapsedMs(started) };
    }
  }
}

/**
 * Keep a duration measured around the tool body (for example after a
 * permission prompt). Otherwise record the time spent in this execute.
 */
function keepToolDuration(result: ToolResult, started: number): ToolResult {
  if (isRecordedDuration(result.durationMs)) return result;
  return { ...result, durationMs: elapsedMs(started) };
}

function elapsedMs(started: number): number {
  const ms = performance.now() - started;
  // A finished body that the clock did not advance still ran.
  if (!Number.isFinite(ms) || ms <= 0) return 0.01;
  return ms;
}
