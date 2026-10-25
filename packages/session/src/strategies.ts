import type { ModelProvider } from "@min/core";
import {
  assembleContext,
  type ContextBudget,
} from "./assemble.js";
import { assembleCompactContext } from "./assemble-compact.js";
import { assembleStickyTrimContext } from "./assemble-sticky-trim.js";
import { assembleToolOffloadContext } from "./assemble-tool-offload.js";
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

export type ContextStrategyId =
  | "trim"
  | "hmt"
  | "tool-offload"
  | "sticky-trim"
  | "compact";

export const CONTEXT_STRATEGY_IDS: ContextStrategyId[] = [
  "trim",
  "hmt",
  "tool-offload",
  "sticky-trim",
  "compact",
];

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

/** Offload oversized tool_results (except protected tail) into stash. */
export function createToolOffloadAssembler(
  budget: ContextBudget,
  stash?: ContextStash,
  opts?: { protectTailTurns?: number },
): ContextAssembler {
  return {
    assemble(input) {
      const merged = mergeBudget(budget, input.budget);
      return assembleToolOffloadContext(
        {
          ...input,
          budget: {
            ...merged,
            stash: stash ?? merged.stash ?? input.budget.stash,
          },
        },
        {
          protectTailTurns: opts?.protectTailTurns ?? 1,
          fold: merged.fold,
        },
      );
    },
  };
}

/** Trim while freezing a sticky leading prefix (cache-friendly). */
export function createStickyTrimAssembler(
  budget: ContextBudget,
  opts?: { stickyTurns?: number },
): ContextAssembler {
  return {
    assemble(input) {
      return assembleStickyTrimContext(
        {
          ...input,
          budget: mergeBudget(budget, input.budget),
        },
        { stickyTurns: opts?.stickyTurns ?? 1 },
      );
    },
  };
}

/** Trim + LLM summary of dropped history when volume warrants it. */
export function createCompactAssembler(
  budget: ContextBudget,
  opts: {
    provider: ModelProvider;
    minDroppedTokens?: number;
    maxSourceChars?: number;
  },
): ContextAssembler {
  return {
    assemble(input) {
      return assembleCompactContext(
        {
          ...input,
          budget: mergeBudget(budget, input.budget),
        },
        {
          provider: opts.provider,
          minDroppedTokens: opts.minDroppedTokens,
          maxSourceChars: opts.maxSourceChars,
        },
      );
    },
  };
}

/**
 * @deprecated Prefer named create*Assembler helpers.
 * Aliases the trim baseline so existing call sites keep working.
 */
export function createBudgetAssembler(
  budget: ContextBudget,
): ContextAssembler {
  return createTrimAssembler(budget);
}

export interface HmtContextExtensionOptions {
  stash?: ContextStash;
  budget?: Partial<ContextBudget> & { maxContextTokens?: number };
}

export function hmtContextExtension(
  opts: HmtContextExtensionOptions = {},
): SessionExtension & { stash: ContextStash; strategy: "hmt" } {
  const stash = opts.stash ?? createContextStash();
  const budget = budgetFromPartial(opts.budget, stash);
  const ext = defineSessionExtension({
    name: "context.hmt",
    assembler: createHmtAssembler(budget, stash),
  });
  return Object.assign(ext, { stash, strategy: "hmt" as const });
}

export function trimContextExtension(
  opts: { budget?: Partial<ContextBudget> & { maxContextTokens?: number } } = {},
): SessionExtension & { strategy: "trim" } {
  const budget = budgetFromPartial(opts.budget);
  const ext = defineSessionExtension({
    name: "context.trim",
    assembler: createTrimAssembler(budget),
  });
  return Object.assign(ext, { strategy: "trim" as const });
}

export interface ToolOffloadExtensionOptions {
  stash?: ContextStash;
  budget?: Partial<ContextBudget> & { maxContextTokens?: number };
  protectTailTurns?: number;
}

export function toolOffloadContextExtension(
  opts: ToolOffloadExtensionOptions = {},
): SessionExtension & { stash: ContextStash; strategy: "tool-offload" } {
  const stash = opts.stash ?? createContextStash();
  const budget = budgetFromPartial(opts.budget, stash);
  const ext = defineSessionExtension({
    name: "context.tool-offload",
    assembler: createToolOffloadAssembler(budget, stash, {
      protectTailTurns: opts.protectTailTurns,
    }),
  });
  return Object.assign(ext, { stash, strategy: "tool-offload" as const });
}

export interface StickyTrimExtensionOptions {
  budget?: Partial<ContextBudget> & { maxContextTokens?: number };
  stickyTurns?: number;
}

export function stickyTrimContextExtension(
  opts: StickyTrimExtensionOptions = {},
): SessionExtension & { strategy: "sticky-trim" } {
  const budget = budgetFromPartial(opts.budget);
  const ext = defineSessionExtension({
    name: "context.sticky-trim",
    assembler: createStickyTrimAssembler(budget, {
      stickyTurns: opts.stickyTurns,
    }),
  });
  return Object.assign(ext, { strategy: "sticky-trim" as const });
}

export interface CompactContextExtensionOptions {
  provider: ModelProvider;
  budget?: Partial<ContextBudget> & { maxContextTokens?: number };
  minDroppedTokens?: number;
  maxSourceChars?: number;
}

/**
 * Explicit LLM compact: trim, then summarize dropped turns when large enough.
 * Pair with a cheap/fast provider when possible.
 */
export function compactContextExtension(
  opts: CompactContextExtensionOptions,
): SessionExtension & { strategy: "compact" } {
  const budget = budgetFromPartial(opts.budget);
  const ext = defineSessionExtension({
    name: "context.compact",
    assembler: createCompactAssembler(budget, {
      provider: opts.provider,
      minDroppedTokens: opts.minDroppedTokens,
      maxSourceChars: opts.maxSourceChars,
    }),
  });
  return Object.assign(ext, { strategy: "compact" as const });
}

export interface ResolveContextStrategyOptions {
  strategy: ContextStrategyId;
  budget?: Partial<ContextBudget> & { maxContextTokens?: number };
  /** Required for `compact`. Usually the same runtime provider. */
  provider?: ModelProvider;
  stash?: ContextStash;
  protectTailTurns?: number;
  stickyTurns?: number;
  minDroppedTokens?: number;
}

/**
 * Build the SessionExtension (+ optional stash) for a strategy id.
 * Strategies that hide tool bodies expose `stash` for recall_context.
 */
export function resolveContextStrategy(opts: ResolveContextStrategyOptions): {
  extension?: SessionExtension;
  stash?: ContextStash;
  strategy: ContextStrategyId;
  needsRecall: boolean;
} {
  switch (opts.strategy) {
    case "trim":
      return {
        strategy: "trim",
        needsRecall: false,
        extension: trimContextExtension({ budget: opts.budget }),
      };
    case "hmt": {
      const ext = hmtContextExtension({
        budget: opts.budget,
        stash: opts.stash,
      });
      return {
        strategy: "hmt",
        extension: ext,
        stash: ext.stash,
        needsRecall: true,
      };
    }
    case "tool-offload": {
      const ext = toolOffloadContextExtension({
        budget: opts.budget,
        stash: opts.stash,
        protectTailTurns: opts.protectTailTurns,
      });
      return {
        strategy: "tool-offload",
        extension: ext,
        stash: ext.stash,
        needsRecall: true,
      };
    }
    case "sticky-trim":
      return {
        strategy: "sticky-trim",
        needsRecall: false,
        extension: stickyTrimContextExtension({
          budget: opts.budget,
          stickyTurns: opts.stickyTurns,
        }),
      };
    case "compact": {
      if (!opts.provider) {
        throw new Error('contextStrategy "compact" requires a provider');
      }
      return {
        strategy: "compact",
        needsRecall: false,
        extension: compactContextExtension({
          provider: opts.provider,
          budget: opts.budget,
          minDroppedTokens: opts.minDroppedTokens,
        }),
      };
    }
    default: {
      const _exhaustive: never = opts.strategy;
      throw new Error(`Unknown context strategy: ${_exhaustive}`);
    }
  }
}

function budgetFromPartial(
  partial?: Partial<ContextBudget> & { maxContextTokens?: number },
  stash?: ContextStash,
): ContextBudget {
  return {
    maxContextTokens: partial?.maxContextTokens ?? 32_000,
    reservedOutputTokens: partial?.reservedOutputTokens ?? 1024,
    maxUserTurns: partial?.maxUserTurns,
    headTurns: partial?.headTurns,
    tailTurns: partial?.tailTurns,
    fold: partial?.fold,
    estimate: partial?.estimate,
    stash: partial?.stash ?? stash,
  };
}

export function mergeBudget(
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
