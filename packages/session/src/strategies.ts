import {
  assembleContext,
  type ContextBudget,
} from "./assemble.js";
import { assembleTrimContext } from "./assemble-trim.js";
import {
  defineSessionExtension,
  type ContextAssembler,
  type SessionExtension,
} from "./extension.js";
import {
  createContextStash,
  type ContextStash,
} from "./stash.js";

export type ContextStrategyId = "trim" | "hmt";

export interface CreateTrimAssemblerOptions {
  budget: ContextBudget;
}

/** Baseline assembler: drop oldest turns under token/turn budget. */
export function createTrimAssembler(
  budget: ContextBudget,
): ContextAssembler {
  return {
    assemble(input) {
      return assembleTrimContext({
        ...input,
        budget: mergeBudget(budget, input.budget),
      });
    },
  };
}

export interface CreateHmtAssemblerOptions {
  budget: ContextBudget;
  stash?: ContextStash;
}

/** H-M-T assembler: stable head, folded middle + stash, verbatim tail. */
export function createHmtAssembler(
  budget: ContextBudget,
  stash?: ContextStash,
): ContextAssembler {
  return {
    assemble(input) {
      const merged = mergeBudget(budget, input.budget);
      return assembleContext({
        ...input,
        budget: {
          ...merged,
          stash: stash ?? merged.stash ?? input.budget.stash,
        },
      });
    },
  };
}

/**
 * @deprecated Prefer {@link createTrimAssembler} or {@link createHmtAssembler}.
 * Aliases the trim baseline so existing call sites keep working.
 */
export function createBudgetAssembler(
  budget: ContextBudget,
): ContextAssembler {
  return createTrimAssembler(budget);
}

export interface HmtContextExtensionOptions {
  /** Shared stash for folded originals / recall_context. Created if omitted. */
  stash?: ContextStash;
  /** H-M-T / fold knobs. `maxContextTokens` may still be overridden per Session budget. */
  budget?: Partial<ContextBudget> & { maxContextTokens?: number };
}

/**
 * Pluggable H-M-T context strategy as a SessionExtension.
 *
 * Install via `createSession({ extensions: [hmtContextExtension()] })` or
 * Runtime `contextStrategy: "hmt"`. Pair with {@link recallContextExtension}
 * using the same `stash` so the model can fetch hidden originals.
 */
export function hmtContextExtension(
  opts: HmtContextExtensionOptions = {},
): SessionExtension & { stash: ContextStash; strategy: "hmt" } {
  const stash = opts.stash ?? createContextStash();
  const budget: ContextBudget = {
    maxContextTokens: opts.budget?.maxContextTokens ?? 32_000,
    reservedOutputTokens: opts.budget?.reservedOutputTokens ?? 1024,
    maxUserTurns: opts.budget?.maxUserTurns,
    headTurns: opts.budget?.headTurns,
    tailTurns: opts.budget?.tailTurns,
    fold: opts.budget?.fold,
    estimate: opts.budget?.estimate,
    stash,
  };

  const ext = defineSessionExtension({
    name: "context.hmt",
    assembler: createHmtAssembler(budget, stash),
  });

  return Object.assign(ext, { stash, strategy: "hmt" as const });
}

/** Baseline trim strategy packaged as an extension (optional; also the Session default). */
export function trimContextExtension(
  opts: { budget?: Partial<ContextBudget> & { maxContextTokens?: number } } = {},
): SessionExtension & { strategy: "trim" } {
  const budget: ContextBudget = {
    maxContextTokens: opts.budget?.maxContextTokens ?? 32_000,
    reservedOutputTokens: opts.budget?.reservedOutputTokens ?? 1024,
    maxUserTurns: opts.budget?.maxUserTurns,
    estimate: opts.budget?.estimate,
  };
  const ext = defineSessionExtension({
    name: "context.trim",
    assembler: createTrimAssembler(budget),
  });
  return Object.assign(ext, { strategy: "trim" as const });
}

function mergeBudget(
  base: ContextBudget,
  overlay: ContextBudget | undefined,
): ContextBudget {
  if (!overlay) return base;
  return {
    maxContextTokens: overlay.maxContextTokens ?? base.maxContextTokens,
    reservedOutputTokens:
      overlay.reservedOutputTokens ?? base.reservedOutputTokens,
    maxUserTurns: overlay.maxUserTurns ?? base.maxUserTurns,
    headTurns: overlay.headTurns ?? base.headTurns,
    tailTurns: overlay.tailTurns ?? base.tailTurns,
    fold: overlay.fold !== undefined ? overlay.fold : base.fold,
    estimate: overlay.estimate ?? base.estimate,
    stash: overlay.stash ?? base.stash,
  };
}
