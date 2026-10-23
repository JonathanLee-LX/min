import {
  createExtensionApi,
  HookBus,
  type Extension,
  type ExtensionState,
} from "./extension.js";
import type { PermissionHandler } from "./permissions.js";
import type { ModelProvider } from "./provider.js";
import { Runner } from "./runner.js";
import { ToolRegistry, type Tool } from "./tools.js";
import type { RunInput, RunResult } from "./types.js";

export interface CreateAgentOptions {
  provider: ModelProvider;
  tools?: Tool[];
  extensions?: Extension[];
  system?: string;
  maxTurns?: number;
  maxTokens?: number;
  /** Optional override; otherwise uses handler set by extensions. */
  permissionHandler?: PermissionHandler;
}

export interface Agent {
  readonly provider: ModelProvider;
  readonly tools: ToolRegistry;
  run(input: RunInput | string): Promise<RunResult>;
  dispose(): Promise<void>;
}

export async function createAgent(opts: CreateAgentOptions): Promise<Agent> {
  const tools = new ToolRegistry();
  for (const tool of opts.tools ?? []) {
    tools.register(tool);
  }

  const hooks = new HookBus();
  const state: ExtensionState = {
    systemAppend: [],
    hooks,
    tools,
  };
  const api = createExtensionApi(state);

  const extensions = opts.extensions ?? [];
  for (const ext of extensions) {
    await ext.setup(api);
  }

  const resolveSystem = (): string | undefined => {
    const parts = [opts.system, ...state.systemAppend].filter(Boolean);
    return parts.length ? parts.join("\n\n") : undefined;
  };

  const runner = new Runner({
    provider: opts.provider,
    tools,
    hooks,
    system: resolveSystem,
    maxTurns: opts.maxTurns,
    maxTokens: opts.maxTokens,
    permissionHandler: opts.permissionHandler ?? state.permissionHandler,
  });

  return {
    provider: opts.provider,
    tools,
    async run(input) {
      const runInput: RunInput = typeof input === "string" ? { input } : input;
      return runner.run(runInput);
    },
    async dispose() {
      for (const ext of extensions) {
        await ext.dispose?.();
      }
    },
  };
}
