/**
 * Measure H-M-T compression vs full canonical context across scenarios.
 * Writes JSON to stdout (and optionally a file) for the canvas / report.
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
  createContextStash,
  estimateMessagesTokens,
  type AssembleResult,
} from "@min/session";

export interface ScenarioRow {
  id: string;
  label: string;
  middleTurns: number;
  blobChars: number;
  canonicalMsgs: number;
  canonicalTokens: number;
  viewTokens: number;
  messageBudget: number;
  foldedParts: number;
  stashedIds: number;
  regions: { headTurns: number; middleTurns: number; tailTurns: number };
  /** view / canonical (lower = more compression) */
  ratio: number;
  /** 1 - ratio */
  saved: number;
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

function measureOne(
  id: string,
  label: string,
  middleTurns: number,
  blobChars: number,
  maxContextTokens = 12_000,
): ScenarioRow {
  const history = buildHistory(middleTurns, blobChars);
  const stash = createContextStash();
  const assembled: AssembleResult = assembleContext({
    messages: history,
    budget: {
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
    },
  });

  const canonicalTokens = estimateMessagesTokens(history);
  const viewTokens = estimateMessagesTokens(assembled.view);
  const ratio = canonicalTokens > 0 ? viewTokens / canonicalTokens : 1;

  return {
    id,
    label,
    middleTurns,
    blobChars,
    canonicalMsgs: history.length,
    canonicalTokens,
    viewTokens,
    messageBudget: assembled.messageBudget,
    foldedParts: assembled.foldedParts ?? 0,
    stashedIds: assembled.stashedIds?.length ?? 0,
    regions: assembled.regions ?? {
      headTurns: 0,
      middleTurns: 0,
      tailTurns: 0,
    },
    ratio,
    saved: 1 - ratio,
    trimmed: assembled.trimmed,
  };
}

function main() {
  const rows: ScenarioRow[] = [];

  // Sweep A: fixed blob size, grow middle turns
  for (const n of [0, 1, 2, 4, 6, 8, 12]) {
    rows.push(
      measureOne(
        `turns_${n}`,
        `${n} middle turns × 18k`,
        n,
        18_000,
      ),
    );
  }

  // Sweep B: fixed 4 middle turns, grow blob size
  for (const chars of [1_000, 4_000, 8_000, 12_000, 18_000, 40_000, 80_000]) {
    rows.push(
      measureOne(
        `blob_${chars}`,
        `4 turns × ${chars >= 1000 ? `${chars / 1000}k` : chars} chars`,
        4,
        chars,
      ),
    );
  }

  // Sweep C: tighter window
  rows.push(
    measureOne("tight_4x18k", "4×18k @ 4k ctx", 4, 18_000, 4_000),
  );
  rows.push(
    measureOne("wide_4x18k", "4×18k @ 32k ctx", 4, 18_000, 32_000),
  );

  const byTurns = rows.filter((r) => r.id.startsWith("turns_"));
  const byBlob = rows.filter((r) => r.id.startsWith("blob_"));
  const budget = rows.filter(
    (r) => r.id.startsWith("tight_") || r.id.startsWith("wide_"),
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    estimator: "~4 chars/token (defaultTokenEstimator)",
    fold: { maxToolResultChars: 1200, head: 200, tail: 200 },
    hmt: { headTurns: 1, tailTurns: 1 },
    byTurns,
    byBlob,
    budget,
    all: rows,
  };

  const outDir = path.dirname(fileURLToPath(import.meta.url));
  const outFile = path.join(outDir, "measure-results.json");
  writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.error(`wrote ${outFile}`);
}

main();
