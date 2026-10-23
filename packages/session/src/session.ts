import {
  userMessage,
  type Agent,
  type Message,
  type RunInput,
  type RunResult,
} from "@min/core";
import type { AssembleResult, ContextBudget } from "./assemble.js";
import {
  createBudgetAssembler,
  resolveSessionExtensions,
  type ContextAssembler,
  type SessionExtension,
  type SessionHookContext,
  type SessionHooks,
} from "./extension.js";
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
  /**
   * Default budget assembler knobs. Ignored when a custom `assembler`
   * (or an extension that sets one) is provided — pass budget into that assembler instead.
   */
  budget?: Partial<ContextBudget> & { maxContextTokens?: number };
  /**
   * Optional system snapshot for budgeting only (estimation).
   * Live system still comes from the Agent each turn.
   */
  systemForBudget?: string | (() => string | undefined);
  /** Replace the default budget assembler entirely. */
  assembler?: ContextAssembler;
  /** Lifecycle hooks (also accept via `extensions`). */
  hooks?: SessionHooks | SessionHooks[];
  /** Composable packs of assembler/hooks. Later assembler wins; hooks run in order. */
  extensions?: SessionExtension[];
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

  const { assembler: extAssembler, hooks: extHooks } =
    resolveSessionExtensions(opts.extensions, createBudgetAssembler(budget));
  // Explicit assembler option wins over extension-provided assemblers.
  const finalAssembler = opts.assembler ?? extAssembler;

  const hooks: SessionHooks[] = [
    ...extHooks,
    ...(opts.hooks
      ? Array.isArray(opts.hooks)
        ? opts.hooks
        : [opts.hooks]
      : []),
  ];

  const resolveSystem = () =>
    typeof opts.systemForBudget === "function"
      ? opts.systemForBudget()
      : opts.systemForBudget;

  const persist = async () => {
    if (!opts.store) return;
    meta = { ...meta, updatedAt: new Date().toISOString() };
    let snapshot: SessionSnapshot = {
      meta: { ...meta },
      messages: [...messages],
    };
    for (const h of hooks) {
      if (!h.onBeforeSave) continue;
      const next = await h.onBeforeSave(snapshot);
      if (next) snapshot = next;
    }
    await opts.store.save(snapshot);
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
      const tools = opts.agent.tools.definitions();
      const system = resolveSystem();
      const hookCtx: SessionHookContext = {
        sessionId: meta.id,
        meta,
        messages,
        input,
        system,
        tools,
      };

      for (const h of hooks) {
        await h.onBeforeRun?.(hookCtx);
      }

      const pending = [...messages, userMessage(input)];
      let assembled = await finalAssembler.assemble({
        messages: pending,
        system,
        tools,
        budget,
      });

      for (const h of hooks) {
        if (!h.onAfterAssemble) continue;
        const next = await h.onAfterAssemble({
          ...hookCtx,
          pending,
          assemble: assembled,
        });
        if (next) assembled = next;
      }

      lastAssemble = assembled;

      const result = await opts.agent.run({
        input: assembled.view,
        signal: runOpts.signal,
        maxTurns: runOpts.maxTurns,
        onEvent: runOpts.onEvent,
        onPermissionAsk: runOpts.onPermissionAsk,
      });

      const nextMessages = [...assembled.dropped, ...result.messages];
      messages = nextMessages;
      if (!meta.title) {
        meta = { ...meta, title: input.slice(0, 80) };
      }

      for (const h of hooks) {
        await h.onAfterRun?.({
          ...hookCtx,
          assemble: assembled,
          result,
          nextMessages,
        });
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
