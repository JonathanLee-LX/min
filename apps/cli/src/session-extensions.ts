import { defineSessionExtension, type SessionExtension } from "@min-agent/session";

function formatAssembleLine(
  assemble: {
    trimmed: boolean;
    foldedParts?: number;
    stashedIds?: string[];
    regions?: { headTurns: number; middleTurns: number; tailTurns: number };
    strategy?: string;
    estimatedTokens: number;
    messageBudget: number;
  },
  when: "assemble" | "run",
): string {
  const folded =
    assemble.foldedParts && assemble.foldedParts > 0
      ? ` · foldedParts=${assemble.foldedParts}`
      : "";
  const stashed =
    assemble.stashedIds && assemble.stashedIds.length
      ? ` · stash=${assemble.stashedIds.length}`
      : "";
  const regions = assemble.regions
    ? ` · H/M/T=${assemble.regions.headTurns}/${assemble.regions.middleTurns}/${assemble.regions.tailTurns}`
    : "";
  const strategy = assemble.strategy
    ? `strategy=${assemble.strategy}`
    : "strategy=?";
  const status = assemble.trimmed
    ? "trimmed"
    : folded || stashed
      ? "projected"
      : "ok";
  return `context[${when}/${status}]: ${strategy} · view~${assemble.estimatedTokens} tokens (budget messages=${assemble.messageBudget})${regions}${folded}${stashed}`;
}

/**
 * Logs model-view budget decisions after each assemble (including mid-loop
 * projections) and again after the run when anything was folded/trimmed.
 */
export function contextBudgetLog(): SessionExtension {
  return defineSessionExtension({
    name: "cli.context-budget-log",
    hooks: {
      onAfterAssemble({ assemble }) {
        // Always log so under-budget single-turn loops are visible too.
        console.error(formatAssembleLine(assemble, "assemble"));
        return assemble;
      },
      onAfterRun({ assemble }) {
        if (!assemble.trimmed && !(assemble.foldedParts && assemble.foldedParts > 0)) {
          return;
        }
        console.error(formatAssembleLine(assemble, "run"));
      },
      onIncoming(texts) {
        const preview = texts.join(" | ");
        const clipped =
          preview.length > 120 ? `${preview.slice(0, 117)}...` : preview;
        console.error(`⊕ follow-up ×${texts.length}: ${clipped}`);
      },
    },
  });
}
