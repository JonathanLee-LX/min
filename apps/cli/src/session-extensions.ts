import { defineSessionExtension, type SessionExtension } from "@min/session";

/** Logs model-view budget decisions after each turn (stderr). */
export function contextBudgetLog(): SessionExtension {
  return defineSessionExtension({
    name: "cli.context-budget-log",
    hooks: {
      onAfterRun({ assemble }) {
        if (!assemble.trimmed) return;
        console.error(
          `context: trimmed ${assemble.dropped.length} msgs · view~${assemble.estimatedTokens} tokens (budget messages=${assemble.messageBudget})`,
        );
      },
    },
  });
}
