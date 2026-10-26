/**
 * Harder live A/B: prevents "answer from earlier assistant memory",
 * buries needles under more fat tool IO, tracks leak/view/recall.
 *
 *   set -a && source ../../.env && set +a
 *   pnpm --filter @min-agent/example-hmt-context exec tsx eval-hard.mts
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdtempSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Message, RunEvent } from "@min-agent/core";
import { createRuntime, resolveProvider } from "@min-agent/runtime";
import {
  CONTEXT_STRATEGY_IDS,
  estimateMessagesTokens,
  parseHiddenIds,
  type ContextStrategyId,
} from "@min-agent/session";

const SECRET = "NEEDLE_HARD_9c2e";
const DISTRACTOR = "NEEDLE_FAKE_0000";
const PREFIX = "ACME";

const STRATEGIES: ContextStrategyId[] = [
  "trim",
  "sticky-trim",
  "tool-offload",
  "hmt",
  "hybrid",
];

interface HardResult {
  strategy: ContextStrategyId;
  ok: boolean;
  latencyMs: number;
  toolCalls: number;
  recallCalls: number;
  readFileCalls: number;
  canonicalTokens: number;
  finalViewTokens: number;
  ratio: number;
  foldedParts: number;
  stashedIds: number;
  /** Secret still visible in final model view tool/text parts. */
  secretInFinalView: boolean;
  /** Secret appeared in any assistant text before the final user turn. */
  secretLeakedEarly: boolean;
  /** Hidden markers present in final view. */
  hiddenMarkers: number;
  answer: string;
  error?: string;
}

function loadEnv(): void {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  try {
    const raw = readFileSync(path.join(root, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue;
      let value = t.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    /* optional */
  }
}

function pad(n: number, ch: string): string {
  return ch.repeat(n);
}

function seedWorkspace(root: string): void {
  mkdirSync(path.join(root, "logs"), { recursive: true });
  mkdirSync(path.join(root, "dumps"), { recursive: true });
  mkdirSync(path.join(root, "src"), { recursive: true });

  writeFileSync(
    path.join(root, "CONSTRAINT.md"),
    [
      "# Constraint",
      `Final secret reports must include PREFIX=${PREFIX}.`,
      "Never invent another prefix.",
    ].join("\n"),
  );

  writeFileSync(
    path.join(root, "src", "app.ts"),
    `export const app = "min-eval";\n`,
  );

  // Real secret buried past fold head/tail windows.
  writeFileSync(
    path.join(root, "logs", "alpha.log"),
    [pad(900, "A"), `SECRET_TOKEN=${SECRET}`, pad(14_000, "a"), "END"].join(
      "\n",
    ),
  );
  writeFileSync(
    path.join(root, "logs", "beta.log"),
    [pad(900, "B"), `SECRET_TOKEN=${DISTRACTOR}`, pad(14_000, "b"), "END"].join(
      "\n",
    ),
  );
  writeFileSync(
    path.join(root, "logs", "gamma.log"),
    [pad(16_000, "G"), "no token here", pad(4_000, "g")].join("\n"),
  );

  for (let i = 0; i < 4; i++) {
    writeFileSync(
      path.join(root, "dumps", `blob-${i}.txt`),
      `blob-${i}\n` + pad(12_000, String(i % 10)),
    );
  }
}

const NO_LEAK = [
  "CRITICAL RULES for this session:",
  "- When reading files, reply with METADATA ONLY (path, bytes, line count).",
  "- Do NOT quote, paraphrase, or repeat any file body substrings, tokens, secrets, or PREFIX values.",
  "- Do NOT use bash to print file bodies (no cat/head/tail/less on logs or dumps). Use read_file for bodies.",
  "- bash is OK only for: ls, wc -l, wc -c, find, glob-like listing.",
].join("\n");

const TURNS = [
  `${NO_LEAK}\n\nRead CONSTRAINT.md with read_file. Acknowledge only with: ACK constraints.`,
  `${NO_LEAK}\n\nUsing read_file (required), read logs/alpha.log, logs/beta.log, and logs/gamma.log completely. Report only path+bytes for each. No body quotes.`,
  `${NO_LEAK}\n\nDistractor pass 1: read_file dumps/blob-0.txt and dumps/blob-1.txt. Metadata only.`,
  `${NO_LEAK}\n\nDistractor pass 2: read_file dumps/blob-2.txt and dumps/blob-3.txt. Then run bash: wc -c logs/*.log dumps/*.txt. Metadata only.`,
  `${NO_LEAK}\n\nDistractor pass 3: glob **/* and read_file src/app.ts. Do not revisit log bodies unless via recall_context.`,
  [
    "FINAL — answer with exactly one line:",
    "PREFIX:<value> SECRET:<token>",
    "where <value> comes from CONSTRAINT.md and <token> is SECRET_TOKEN from logs/alpha.log (NOT beta).",
    "If the log body is no longer in your context, you MUST call recall_context (list ids if needed) before answering.",
  ].join("\n"),
];

function grade(answer: string): boolean {
  const n = answer.replace(/\s+/g, " ");
  const pref = n.includes(`PREFIX:${PREFIX}`) || n.includes(`PREFIX=${PREFIX}`);
  const sec = n.includes(`SECRET:${SECRET}`) || n.includes(SECRET);
  const notFake = !n.includes(DISTRACTOR);
  return pref && sec && notFake;
}

function messageHasSecret(messages: readonly Message[]): boolean {
  for (const m of messages) {
    for (const p of m.content) {
      if (p.type === "text" && p.text.includes(SECRET)) return true;
      if (p.type === "tool_result" && p.content.includes(SECRET)) return true;
    }
  }
  return false;
}

function countHiddenMarkers(messages: readonly Message[]): number {
  let n = 0;
  for (const m of messages) {
    for (const p of m.content) {
      if (p.type === "tool_result") n += parseHiddenIds(p.content).length;
      if (p.type === "text") n += parseHiddenIds(p.text).length;
    }
  }
  return n;
}

function earlyAssistantLeak(messages: readonly Message[]): boolean {
  // All messages except after the final user prompt's following assistant replies:
  // simpler: any assistant text containing SECRET before the last user message.
  let lastUser = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role === "user") lastUser = i;
  }
  for (let i = 0; i < lastUser; i++) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    for (const p of m.content) {
      if (p.type === "text" && p.text.includes(SECRET)) return true;
    }
  }
  return false;
}

async function runStrategy(
  strategy: ContextStrategyId,
  workspace: string,
): Promise<HardResult> {
  const provider = resolveProvider({ provider: "deepseek" });
  const rt = await createRuntime({
    cwd: workspace,
    provider,
    contextStrategy: strategy,
    noSessionStore: true,
    allowBash: true,
    maxContextTokens: 6_000,
  });

  let toolCalls = 0;
  let recallCalls = 0;
  let readFileCalls = 0;
  const onEvent = (ev: RunEvent) => {
    if (ev.type !== "tool_call") return;
    toolCalls += 1;
    if (ev.toolCall.name === "recall_context") recallCalls += 1;
    if (ev.toolCall.name === "read_file") readFileCalls += 1;
    process.stderr.write(`  [${strategy}] → ${ev.toolCall.name}\n`);
  };

  const t0 = Date.now();
  let answer = "";
  try {
    for (let i = 0; i < TURNS.length; i++) {
      process.stderr.write(`  [${strategy}] turn ${i + 1}/${TURNS.length}\n`);
      const result = await rt.session.run(TURNS[i]!, {
        onEvent,
        maxTurns: 14,
        onPermissionAsk: async () => "allow",
      });
      answer = result.text ?? "";
    }
  } catch (err) {
    const canonicalTokens = estimateMessagesTokens([...rt.session.messages]);
    await rt.agent.dispose();
    return {
      strategy,
      ok: false,
      latencyMs: Date.now() - t0,
      toolCalls,
      recallCalls,
      readFileCalls,
      canonicalTokens,
      finalViewTokens: rt.session.lastAssemble?.estimatedTokens ?? 0,
      ratio: 0,
      foldedParts: rt.session.lastAssemble?.foldedParts ?? 0,
      stashedIds: rt.session.lastAssemble?.stashedIds?.length ?? 0,
      secretInFinalView: false,
      secretLeakedEarly: false,
      hiddenMarkers: 0,
      answer: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const view = rt.session.lastAssemble?.view ?? [];
  const canonicalTokens = estimateMessagesTokens([...rt.session.messages]);
  const finalViewTokens = rt.session.lastAssemble?.estimatedTokens ?? 0;

  const row: HardResult = {
    strategy,
    ok: grade(answer),
    latencyMs: Date.now() - t0,
    toolCalls,
    recallCalls,
    readFileCalls,
    canonicalTokens,
    finalViewTokens,
    ratio: canonicalTokens > 0 ? finalViewTokens / canonicalTokens : 1,
    foldedParts: rt.session.lastAssemble?.foldedParts ?? 0,
    stashedIds: rt.session.lastAssemble?.stashedIds?.length ?? 0,
    secretInFinalView: messageHasSecret(view),
    secretLeakedEarly: earlyAssistantLeak(rt.session.messages),
    hiddenMarkers: countHiddenMarkers(view),
    answer: answer.slice(0, 280),
  };

  await rt.agent.dispose();
  return row;
}

async function main() {
  loadEnv();
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("DEEPSEEK_API_KEY missing");
    process.exit(1);
  }
  process.env.PROVIDER = "deepseek";

  const only = process.argv
    .filter((a) => a.startsWith("--only="))
    .map((a) => a.slice("--only=".length) as ContextStrategyId);
  const strategies = only.length
    ? STRATEGIES.filter((s) => only.includes(s))
    : STRATEGIES;

  for (const s of strategies) {
    if (!CONTEXT_STRATEGY_IDS.includes(s)) {
      throw new Error(`Unknown strategy ${s}`);
    }
  }

  const base = mkdtempSync(path.join(os.tmpdir(), "min-ctx-hard-"));
  console.error(`workspace: ${base}`);
  console.error(`strategies: ${strategies.join(", ")}`);
  console.error(
    `secret=${SECRET} fake=${DISTRACTOR} prefix=${PREFIX} maxContext=6000 turns=${TURNS.length}\n`,
  );

  const results: HardResult[] = [];
  for (const strategy of strategies) {
    const cwd = path.join(base, strategy);
    mkdirSync(cwd, { recursive: true });
    seedWorkspace(cwd);
    process.stderr.write(`\n=== ${strategy} ===\n`);
    const row = await runStrategy(strategy, cwd);
    results.push(row);
    process.stderr.write(
      `=> ok=${row.ok} view=${row.finalViewTokens} canon=${row.canonicalTokens} recall=${row.recallCalls} leak=${row.secretLeakedEarly} inView=${row.secretInFinalView} ${row.latencyMs}ms\n`,
    );
    process.stderr.write(`   answer: ${row.answer || row.error || "(empty)"}\n`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    task: "hard: no-leak metadata-only + distractors + alpha secret vs beta decoy",
    provider: `deepseek:${process.env.DEEPSEEK_MODEL ?? "deepseek-flash"}`,
    maxContextTokens: 6_000,
    secret: SECRET,
    distractor: DISTRACTOR,
    prefix: PREFIX,
    turns: TURNS.length,
    results,
    analysisNotes: [
      "Earlier soft eval looked odd because models could answer from prior-turn memory after seeing full tool bodies once; folding later does not erase that.",
      "This hard eval forbids quoting bodies and adds distractor dumps so the secret is less likely to sit in recent assistant text.",
      "Recall is only available on stash strategies (hmt, tool-offload, hybrid).",
    ],
  };

  const outFile = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "eval-hard-results.json",
  );
  writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.error(`\nwrote ${outFile}`);

  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
