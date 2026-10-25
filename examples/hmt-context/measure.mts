/**
 * Measure context strategies vs full canonical history.
 * Compares baseline `trim` and experimental `hmt` on the same histories.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assistantMessage,
  textPart,
  toolCallPart,
  toolMessage,
  toolResultPart,
  userMessage,
  type Message,
} from "@min/core";
import {
  assembleContext,
  assembleTrimContext,
  createContextStash,
  estimateMessagesTokens,
} from "@min/session";

interface ScenarioRow {
  id: string;
  label: string;
  strategy: "trim" | "hmt";
  middleTurns: number;
  blobChars: number;
  canonicalTokens: number;
  viewTokens: number;
  ratio: number;
  savedPct: number;
  foldedParts: number;
  stashedIds: number;
  trimmed: boolean;
}

function buildHistory(middleTurns: number, blobChars: number): Message[] {
  const msgs: Message[] = [];
  msgs.push(userMessage("Constraint: prefer relative paths under src/."));
  msgs.push(assistantMessage([textPart("Understood.")]));

  for (let i = 0; i < middleTurns; i++) {
    const id = `m${i}`;
    msgs.push(userMessage(`middle task ${i}`));
    msgs.push(
      assistantMessage([toolCallPart(id, "bash", { command: `cat b${i}` })]),
    );
    msgs.push(toolMessage([toolResultPart(id, "X".repeat(blobChars))]));
  }

  msgs.push(userMessage("tail: continue the current task"));
  msgs.push(assistantMessage([textPart("Working on the handler next.")]));
  return msgs;
}

function measure(
  strategy: "trim" | "hmt",
  id: string,
  label: string,
  middleTurns: number,
  blobChars: number,
  maxContextTokens = 12_000,
): ScenarioRow {
  const history = buildHistory(middleTurns, blobChars);
  const stash = createContextStash();
  const budget = {
    maxContextTokens,
    reservedOutputTokens: 1024,
    headTurns: 1,
    tailTurns: 1,
    fold: {
      maxToolResultChars: 1200,
      toolResultHeadChars: 200,
      toolResultTailChars: 200,
    },
    stash,
  } as const;

  const assembled =
    strategy === "hmt"
      ? assembleContext({ messages: history, budget })
      : assembleTrimContext({ messages: history, budget });

  const canonicalTokens = estimateMessagesTokens(history);
  const viewTokens = estimateMessagesTokens(assembled.view);
  const ratio = canonicalTokens > 0 ? viewTokens / canonicalTokens : 1;

  return {
    id: `${strategy}_${id}`,
    label,
    strategy,
    middleTurns,
    blobChars,
    canonicalTokens,
    viewTokens,
    ratio,
    savedPct: (1 - ratio) * 100,
    foldedParts: assembled.foldedParts ?? 0,
    stashedIds: assembled.stashedIds?.length ?? 0,
    trimmed: assembled.trimmed,
  };
}

function main() {
  const rows: ScenarioRow[] = [];
  for (const n of [0, 1, 2, 4, 8, 12]) {
    for (const strategy of ["trim", "hmt"] as const) {
      rows.push(
        measure(strategy, `turns_${n}`, `${n} middle × 18k`, n, 18_000),
      );
    }
  }
  for (const chars of [1_000, 4_000, 8_000, 18_000, 40_000, 80_000]) {
    for (const strategy of ["trim", "hmt"] as const) {
      rows.push(
        measure(
          strategy,
          `blob_${chars}`,
          `4 turns × ${chars / 1000}k`,
          4,
          chars,
        ),
      );
    }
  }

  const paired = [];
  for (const n of [0, 1, 2, 4, 8, 12]) {
    const trim = rows.find((r) => r.id === `trim_turns_${n}`)!;
    const hmt = rows.find((r) => r.id === `hmt_turns_${n}`)!;
    paired.push({
      middleTurns: n,
      full: trim.canonicalTokens,
      trimView: trim.viewTokens,
      hmtView: hmt.viewTokens,
      trimSavedPct: +trim.savedPct.toFixed(1),
      hmtSavedPct: +hmt.savedPct.toFixed(1),
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    note: "trim = Session default baseline; hmt = experimental plug-in strategy",
    estimator: "~4 chars/token",
    pairedByTurns: paired,
    all: rows,
  };

  const outDir = path.dirname(fileURLToPath(import.meta.url));
  writeFileSync(path.join(outDir, "measure-results.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main();
