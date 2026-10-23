import type { PermissionHandler } from "./permissions.js";
import type { Message, ToolCallPart } from "./types.js";
import type { Tool, ToolContext, ToolResult, ToolRegistry } from "./tools.js";

export interface HookContext {
  messages: Message[];
  turn: number;
  signal?: AbortSignal;
}

export interface Hooks {
  onBeforeTurn?: (ctx: HookContext) => void | Promise<void>;
  onAfterTurn?: (ctx: HookContext & { message: Message }) => void | Promise<void>;
  onBeforeTool?: (
    ctx: HookContext & { toolCall: ToolCallPart },
  ) => void | Promise<void>;
  onAfterTool?: (
    ctx: HookContext & { toolCall: ToolCallPart; result: ToolResult },
  ) => void | Promise<void>;
  onError?: (ctx: HookContext & { error: Error }) => void | Promise<void>;
}

export interface ExtensionApi {
  registerTool(tool: Tool): void;
  addHook(hooks: Hooks): void;
  /** Mutate system prompt before the run (extensions may append). */
  appendSystem(text: string): void;
  getTools(): ToolRegistry;
  /** Last writer wins. Policy extensions call this once in setup. */
  setPermissionHandler(handler: PermissionHandler): void;
}

export interface Extension {
  name: string;
  setup(api: ExtensionApi): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export class HookBus {
  private readonly hooks: Hooks[] = [];

  add(hooks: Hooks): void {
    this.hooks.push(hooks);
  }

  async emitBeforeTurn(ctx: HookContext): Promise<void> {
    for (const h of this.hooks) await h.onBeforeTurn?.(ctx);
  }

  async emitAfterTurn(ctx: HookContext & { message: Message }): Promise<void> {
    for (const h of this.hooks) await h.onAfterTurn?.(ctx);
  }

  async emitBeforeTool(
    ctx: HookContext & { toolCall: ToolCallPart },
  ): Promise<void> {
    for (const h of this.hooks) await h.onBeforeTool?.(ctx);
  }

  async emitAfterTool(
    ctx: HookContext & { toolCall: ToolCallPart; result: ToolResult },
  ): Promise<void> {
    for (const h of this.hooks) await h.onAfterTool?.(ctx);
  }

  async emitError(ctx: HookContext & { error: Error }): Promise<void> {
    for (const h of this.hooks) await h.onError?.(ctx);
  }
}

/** Shared mutable state extensions write into during setup. */
export interface ExtensionState {
  systemAppend: string[];
  hooks: HookBus;
  tools: ToolRegistry;
  permissionHandler?: PermissionHandler;
}

export function createExtensionApi(state: ExtensionState): ExtensionApi {
  return {
    registerTool(tool) {
      state.tools.register(tool);
    },
    addHook(hooks) {
      state.hooks.add(hooks);
    },
    appendSystem(text) {
      if (text.trim()) state.systemAppend.push(text.trim());
    },
    getTools() {
      return state.tools;
    },
    setPermissionHandler(handler) {
      state.permissionHandler = handler;
    },
  };
}

/** No-op helper so callers can type-check custom extensions. */
export function defineExtension(ext: Extension): Extension {
  return ext;
}

// Re-export ToolContext for extension authors
export type { ToolContext, ToolResult };
