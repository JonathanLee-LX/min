import {
  splitUserTurns,
  type AssembleInput,
  type AssembleResult,
} from "./assemble.js";
import { defaultTokenEstimator } from "./tokens.js";

export interface StickyTrimOptions {
  /**
   * Number of leading user-turns frozen in the view (cache-stable prefix).
   * Default: 1.
   */
  stickyTurns?: number;
}

/**
 * Like trim, but never drops the leading sticky turns first — only shrinks
 * turns after the sticky prefix. Better prefix-cache behavior than plain trim.
 *
 * Canonical history is preserved (`kept` = full input); only the model view
 * is projected (same store contract as H-M-T / tool-offload).
 */
export function assembleStickyTrimContext(
  input: AssembleInput,
  opts: StickyTrimOptions = {},
): AssembleResult {
  const estimate = input.budget.estimate ?? defaultTokenEstimator;
  const reserved = input.budget.reservedOutputTokens ?? 1024;
  const overhead =
    estimate.system(input.system) + estimate.tools(input.tools ?? []);
  const messageBudget = Math.max(
    256,
    input.budget.maxContextTokens - reserved - overhead,
  );

  const stickyN = Math.max(0, opts.stickyTurns ?? 1);
  const turns = splitUserTurns(input.messages);

  if (turns.length === 0) {
    return {
      view: [],
      kept: input.messages,
      dropped: [],
      estimatedTokens: overhead,
      messageBudget,
      trimmed: false,
      foldedParts: 0,
      stashedIds: [],
      strategy: "sticky-trim",
      regions: { headTurns: 0, middleTurns: 0, tailTurns: 0 },
    };
  }

  const stickyCount = Math.min(stickyN, turns.length);
  const sticky = turns.slice(0, stickyCount);
  let rest = turns.slice(stickyCount);

  const maxUserTurns = input.budget.maxUserTurns;
  if (maxUserTurns && maxUserTurns > 0) {
    const maxRest = Math.max(0, maxUserTurns - stickyCount);
    if (rest.length > maxRest) {
      rest = rest.slice(rest.length - maxRest);
    }
  }

  while (rest.length > 1) {
    const flat = [...sticky.flat(), ...rest.flat()];
    if (estimate.messages(flat) <= messageBudget) break;
    rest = rest.slice(1);
  }

  let stickyKept = sticky;
  while (stickyKept.length > 1) {
    const flat = [...stickyKept.flat(), ...rest.flat()];
    if (estimate.messages(flat) <= messageBudget) break;
    stickyKept = stickyKept.slice(1);
  }

  const view = [...stickyKept.flat(), ...rest.flat()];
  const viewTokens = estimate.messages(view);
  const trimmed = view.length < input.messages.length;

  return {
    view,
    kept: input.messages,
    dropped: [],
    estimatedTokens: overhead + viewTokens,
    messageBudget,
    trimmed,
    foldedParts: 0,
    stashedIds: [],
    strategy: "sticky-trim",
    regions: {
      headTurns: stickyKept.length,
      middleTurns: 0,
      tailTurns: rest.length,
    },
  };
}
