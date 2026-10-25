import { defineSessionExtension, type SessionExtension } from "@min/session";

/** Logs model-view budget decisions after each turn (stderr). */
export function contextBudgetLog(): SessionExtension {
  return defineSessionExtension({
    name: "cli.context-budget-log",
    hooks: {
      onAfterRun({ assemble }) {
        if (!assemble.trimmed) return;
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
        const strategy = assemble.strategy ? `strategy=${assemble.strategy}` : "strategy=?";
        console.error(
          `context: ${strategy} · view~${assemble.estimatedTokens} tokens (budget messages=${assemble.messageBudget})${regions}${folded}${stashed}`,
        );
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
