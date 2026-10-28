import type { ModelProvider } from "./provider.js";
import { Runner } from "./runner.js";
import { ToolRegistry, type Tool } from "./tools.js";
import type { Message, RunInput, RunResult } from "./types.js";

const inflightOf = new WeakMap<Agent, () => Message[] | undefined>();

/**
 * In-progress Runner messages for an Agent created by `createAgent`.
 * Does not add keys to the Agent object (permissions stay off that surface).
 */
export function snapshotAgentInFlight(agent: Agent): Message[] | undefined {
  return inflightOf.get(agent)?.();
}

export interface CreateAgentOptions {
  provider: ModelProvider;
  tools?: Tool[];
  system?: string | (() => string | undefined);
  maxTurns?: number;
  maxTokens?: number;
}

export interface Agent {
  readonly provider: ModelProvider;
  readonly tools: ToolRegistry;
  run(input: RunInput | string): Promise<RunResult>;
  /** Kept so existing hosts can tear down uniformly. Core holds no resources. */
  dispose(): Promise<void>;
}

export async function createAgent(opts: CreateAgentOptions): Promise<Agent> {
  const tools = new ToolRegistry();
  for (const tool of opts.tools ?? []) {
    tools.register(tool);
  }

  const runner = new Runner({
    provider: opts.provider,
    tools,
    system: opts.system,
    maxTurns: opts.maxTurns,
    maxTokens: opts.maxTokens,
  });

  const agent: Agent = {
    provider: opts.provider,
    tools,
    async run(input) {
      const runInput: RunInput = typeof input === "string" ? { input } : input;
      return runner.run(runInput);
    },
    async dispose() {},
  };
  inflightOf.set(agent, () => runner.snapshotInFlight());
  return agent;
}
