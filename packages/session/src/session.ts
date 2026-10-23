import {
  userMessage,
  type Agent,
  type Message,
  type RunInput,
  type RunResult,
  type ToolDefinition,
} from "@min/core";
import {
  assembleContext,
  type AssembleResult,
  type ContextBudget,
} from "./assemble.js";
import {
  newSessionId,
  type SessionMeta,
  type SessionSnapshot,
  type SessionStore,
} from "./store.js";

export const DEFAULT_MAX_CONTEXT_TOKENS = 32_000;

export interface CreateSessionOptions {
  agent: Agent;
  id?: string;
  title?: string;
  store?: SessionStore;
  initialMessages?: Message[];
  /** Context window / cost budget for model views. */
  budget?: Partial<ContextBudget> & { maxContextTokens?: number };
  /**
   * Optional system snapshot for budgeting only (estimation).
   * Live system still comes from the Agent each turn.
   */
  systemForBudget?: string | (() => string | undefined);
}

export interface SessionRunOptions {
  signal?: AbortSignal;
  maxTurns?: number;
  onEvent?: RunInput["onEvent"];
  onPermissionAsk?: RunInput["onPermissionAsk"];
}

export interface Session {
  readonly id: string;
  readonly meta: SessionMeta;
  /** Canonical full history (not trimmed). */
  readonly messages: readonly Message[];
  /** Last assemble info from run(), if any. */
  readonly lastAssemble?: AssembleResult;
  run(input: string, opts?: SessionRunOptions): Promise<RunResult>;
  reset(messages?: Message[]): void;
  export(): SessionSnapshot;
  dispose(): Promise<void>;
}

export async function createSession(
  opts: CreateSessionOptions,
): Promise<Session> {
  const now = new Date().toISOString();
  let meta: SessionMeta = {
    id: opts.id ?? newSessionId(),
    title: opts.title,
    createdAt: now,
    updatedAt: now,
  };
  let messages: Message[] = opts.initialMessages
    ? [...opts.initialMessages]
    : [];
  let lastAssemble: AssembleResult | undefined;

  if (opts.store && opts.id) {
    const loaded = await opts.store.load(opts.id);
    if (loaded) {
      meta = loaded.meta;
      messages = [...loaded.messages];
    }
  }

  const budget: ContextBudget = {
    maxContextTokens:
      opts.budget?.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS,
    reservedOutputTokens: opts.budget?.reservedOutputTokens ?? 1024,
    maxUserTurns: opts.budget?.maxUserTurns,
  };

  const resolveSystem = () =>
    typeof opts.systemForBudget === "function"
      ? opts.systemForBudget()
      : opts.systemForBudget;

  const persist = async () => {
    if (!opts.store) return;
    meta = { ...meta, updatedAt: new Date().toISOString() };
    await opts.store.save({ meta, messages: [...messages] });
  };

  const session: Session = {
    get id() {
      return meta.id;
    },
    get meta() {
      return meta;
    },
    get messages() {
      return messages;
    },
    get lastAssemble() {
      return lastAssemble;
    },

    async run(input, runOpts = {}) {
      const pending = [...messages, userMessage(input)];
      const tools: ToolDefinition[] = opts.agent.tools.definitions();
      const assembled = assembleContext({
        messages: pending,
        system: resolveSystem(),
        tools,
        budget,
      });
      lastAssemble = assembled;

      const result = await opts.agent.run({
        input: assembled.view,
        signal: runOpts.signal,
        maxTurns: runOpts.maxTurns,
        onEvent: runOpts.onEvent,
        onPermissionAsk: runOpts.onPermissionAsk,
      });

      // Rehydrate canonical history: dropped prefix + model view trajectory
      messages = [...assembled.dropped, ...result.messages];
      if (!meta.title) {
        meta = { ...meta, title: input.slice(0, 80) };
      }
      await persist();
      return result;
    },

    reset(next) {
      messages = next ? [...next] : [];
      lastAssemble = undefined;
    },

    export() {
      return { meta: { ...meta }, messages: [...messages] };
    },

    async dispose() {
      await persist();
    },
  };

  return session;
}
