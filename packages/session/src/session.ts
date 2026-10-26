import {
  userMessage,
  type Agent,
  type Message,
  type RunInput,
  type RunResult,
  type ToolCallPart,
} from "@min/core";
import type { AssembleResult, ContextBudget } from "./assemble.js";
import {
  compactHistoryMessages,
  type CompactHistoryResult,
} from "./assemble-compact.js";
import {
  resolveSessionExtensions,
  type ContextAssembler,
  type SessionExtension,
  type SessionHookContext,
  type SessionHooks,
} from "./extension.js";
import {
  createInputQueue,
  joinIncoming,
  type InputQueue,
  type InputQueueOptions,
} from "./input-queue.js";
import { attachMessageProjection, type MessageProjector } from "./project.js";
import type { ContextStash } from "./stash.js";
import { createTrimAssembler } from "./strategies.js";
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
   * Optional stash for folded/hidden originals (used by H-M-T + recall).
   * Not created by default — install `hmtContextExtension` (or pass a stash)
   * when evaluating / enabling that strategy.
   */
  stash?: ContextStash;
  /**
   * Optional system snapshot for budgeting only (estimation).
   * Live system still comes from the Agent each turn.
   */
  systemForBudget?: string | (() => string | undefined);
  /** Replace the default budget assembler entirely. */
  assembler?: ContextAssembler;
  /** Lifecycle hooks (also accept via `extensions`). */
  hooks?: SessionHooks | SessionHooks[];
  /**
   * Installed around each `run` so a permission gate outside core can see
   * the per-run approver. Cleared when the run returns.
   */
  bindPermissionAsk?: (ask: SessionPermissionAsk | undefined) => void;
  /** Composable packs of assembler/hooks. Later assembler wins; hooks run in order. */
  extensions?: SessionExtension[];
  /**
   * Follow-up queue for interjections during / after a run.
   * Defaults to enqueue + 1.5s dense-latest window.
   * Pass `false` to disable. Does not modify `@min/core`.
   */
  inputQueue?: InputQueue | InputQueueOptions | false;
}

export type SessionPermissionAsk = (req: {
  toolCall: ToolCallPart;
  reason: string;
  grantRoot?: string;
}) => Promise<"allow" | "deny" | "allow_session">;

export interface SessionRunOptions {
  signal?: AbortSignal;
  maxTurns?: number;
  onEvent?: RunInput["onEvent"];
  onPermissionAsk?: SessionPermissionAsk;
}

export interface Session {
  readonly id: string;
  readonly meta: SessionMeta;
  /** Canonical full history (not trimmed). */
  readonly messages: readonly Message[];
  /** Last assemble info from run(), if any. */
  readonly lastAssemble?: AssembleResult;
  /** Folded/hidden originals when an H-M-T (or custom) stash is attached. */
  readonly stash?: ContextStash;
  /** Follow-up queue (undefined when disabled). */
  readonly inputQueue?: InputQueue;
  run(input: string, opts?: SessionRunOptions): Promise<RunResult>;
  /**
   * Explicit on-demand compact: summarize older turns via the agent provider
   * and rewrite canonical history to `[summary] + recent turns`.
   * Not part of the continuous assemble strategy path.
   */
  compact(opts?: {
    keepRecentTurns?: number;
    signal?: AbortSignal;
  }): Promise<CompactHistoryResult>;
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
  const stash = opts.stash ?? opts.budget?.stash;

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
    headTurns: opts.budget?.headTurns,
    tailTurns: opts.budget?.tailTurns,
    fold: opts.budget?.fold,
    estimate: opts.budget?.estimate,
    stash,
  };

  // Default strategy = trim (eval baseline). H-M-T plugs in via extensions.
  const { assembler: extAssembler, hooks: extHooks } =
    resolveSessionExtensions(opts.extensions, createTrimAssembler(budget));
  const finalAssembler = opts.assembler ?? extAssembler;

  const inputQueue = resolveInputQueue(opts.inputQueue);
  const projection = attachMessageProjection(opts.agent.provider);

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

  /** One agent pass: assemble → agent.run → update canonical history. */
  const runOnce = async (
    userText: string,
    runOpts: SessionRunOptions,
  ): Promise<RunResult> => {
    const tools = opts.agent.tools.definitions();
    const system = resolveSystem();
    const hookCtx: SessionHookContext = {
      sessionId: meta.id,
      meta,
      messages,
      input: userText,
      system,
      tools,
    };

    for (const h of hooks) {
      await h.onBeforeRun?.(hookCtx);
    }

    const pending = [...messages, userMessage(userText)];
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

    // Seed the Runner with the full pending turn (never the folded/trimmed
    // view). The provider wrapper re-assembles a model-only view before
    // every complete — including the first — so mid-loop growth stays
    // foldable and lastAssemble reflects the real projection.
    const project: MessageProjector = async (inFlight) => {
      let projected = await finalAssembler.assemble({
        messages: [...inFlight],
        system,
        tools,
        budget,
      });
      for (const h of hooks) {
        if (!h.onAfterAssemble) continue;
        const next = await h.onAfterAssemble({
          ...hookCtx,
          pending: [...inFlight],
          assemble: projected,
        });
        if (next) projected = next;
      }
      lastAssemble = projected;
      return projected.view;
    };

    projection.set(project);
    opts.bindPermissionAsk?.(runOpts.onPermissionAsk);
    let result: RunResult;
    try {
      result = await opts.agent.run({
        input: pending,
        signal: runOpts.signal,
        maxTurns: runOpts.maxTurns,
        onEvent: runOpts.onEvent,
      });
    } finally {
      projection.set(undefined);
      opts.bindPermissionAsk?.(undefined);
    }

    // Runner history is canonical for this turn (pending + generated).
    messages = result.messages;
    const nextMessages = messages;
    if (!meta.title) {
      meta = { ...meta, title: userText.slice(0, 80) };
    }

    for (const h of hooks) {
      await h.onAfterRun?.({
        ...hookCtx,
        assemble: assembled,
        result,
        nextMessages,
      });
    }

    return result;
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
    get stash() {
      return stash;
    },
    get inputQueue() {
      return inputQueue;
    },


    async run(input, runOpts = {}) {
      let result = await runOnce(input, runOpts);

      // Session-level follow-ups only — core Runner is unchanged.
      // Interjections queued during the agent loop are applied after it returns.
      while (
        inputQueue &&
        inputQueue.size > 0 &&
        !runOpts.signal?.aborted
      ) {
        const parts = inputQueue.drain();
        const follow = joinIncoming(parts);
        if (!follow) break;

        for (const h of hooks) {
          await h.onIncoming?.(parts);
        }

        result = await runOnce(follow, runOpts);
      }

      await persist();
      return result;
    },

    async compact(compactOpts = {}) {
      const result = await compactHistoryMessages(messages, {
        provider: opts.agent.provider,
        keepRecentTurns: compactOpts.keepRecentTurns,
        signal: compactOpts.signal,
      });
      messages = result.messages;
      lastAssemble = undefined;
      stash?.clear();
      await persist();
      return result;
    },

    reset(next) {
      messages = next ? [...next] : [];
      lastAssemble = undefined;
      stash?.clear();
      inputQueue?.clear();
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

function resolveInputQueue(
  opt: CreateSessionOptions["inputQueue"],
): InputQueue | undefined {
  if (opt === false) return undefined;
  if (
    opt &&
    typeof opt === "object" &&
    "drain" in opt &&
    typeof (opt as InputQueue).drain === "function"
  ) {
    return opt as InputQueue;
  }
  return createInputQueue({
    mode: "enqueue",
    denseWindowMs: 1500,
    denseMode: "dense-latest",
    ...(opt && typeof opt === "object" ? (opt as InputQueueOptions) : {}),
  });
}
