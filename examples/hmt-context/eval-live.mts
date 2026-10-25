/**
 * Live A/B of context strategies on one real workspace task (DeepSeek).
 *
 *   set -a && source ../../.env && set +a
 *   pnpm --filter @min/example-hmt-context exec tsx eval-live.mts
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import type { RunEvent } from "@min/core";
import { createRuntime, resolveProvider } from "@min/runtime";
import {
  CONTEXT_STRATEGY_IDS,
  estimateMessagesTokens,
  type ContextStrategyId,
} from "@min/session";

const SECRET = "NEEDLE_7f3c91";
const PREFIX = "ACME";
const STRATEGIES: ContextStrategyId[] = [
  "trim",
  "sticky-trim",
  "tool-offload",
  "hmt",
  "hybrid",
];

interface StrategyResult {
  strategy: ContextStrategyId;
  ok: boolean;
  latencyMs: number;
  turns: number;
  toolCalls: number;
  recallCalls: number;
  canonicalTokens: number;
  finalViewTokens: number;
  ratio: number;
  foldedParts: number;
  stashedIds: number;
  answer: string;
  error?: string;
}

function loadEnv(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const envPath = path.join(root, ".env");
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    return;
  }
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
}

function seedWorkspace(root: string): void {
  mkdirSync(path.join(root, "logs"), { recursive: true });
  mkdirSync(path.join(root, "src"), { recursive: true });

  writeFileSync(
    path.join(root, "CONSTRAINT.md"),
    [
      "# Project constraint",
      "",
      `When reporting secrets, the answer MUST start with PREFIX=${PREFIX}.`,
      "Do not invent other prefixes.",
      "",
    ].join("\n"),
  );

  writeFileSync(
    path.join(root, "notes.txt"),
    "Scratch notes.\nPrefer relative paths under src/.\n",
  );

  writeFileSync(
    path.join(root, "src", "main.ts"),
    `export function main() {\n  return "ok";\n}\n`,
  );

  // Large logs: secret buried past typical fold head (200–400 chars).
  const pad = (n: number, ch: string) => ch.repeat(n);
  writeFileSync(
    path.join(root, "logs", "big-a.log"),
    [
      pad(600, "A"),
      `SECRET_TOKEN=${SECRET}`,
      pad(12_000, "a"),
      "END_A",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, "logs", "big-b.log"),
    [pad(8_000, "B"), "noise only", pad(8_000, "b")].join("\n"),
  );
  writeFileSync(
    path.join(root, "logs", "big-c.log"),
    [pad(10_000, "C"), "still noise", pad(6_000, "c")].join("\n"),
  );
}

const TURNS = [
  "Read CONSTRAINT.md carefully. Remember the required PREFIX for later answers. Do not skip this file.",
  "Explore the workspace: list files with glob, then read logs/big-a.log, logs/big-b.log, and logs/big-c.log in full using read_file (not head). Summarize sizes only.",
  "Run bash: wc -l logs/*.log && head -n 3 notes.txt. Then briefly confirm you still remember the PREFIX rule from CONSTRAINT.md.",
  `Final answer only — one line exactly in this form:\nPREFIX:<value> SECRET:<token>\nwhere <value> is the PREFIX from CONSTRAINT.md and <token> is SECRET_TOKEN from the log that contained it.`,
];

function grade(answer: string): boolean {
  const norm = answer.replace(/\s+/g, " ").trim();
  // Model may follow CONSTRAINT.md literal `PREFIX=ACME` instead of `PREFIX:`.
  const prefixOk =
    norm.includes(`PREFIX:${PREFIX}`) || norm.includes(`PREFIX=${PREFIX}`);
  const secretOk =
    norm.includes(`SECRET:${SECRET}`) || norm.includes(SECRET);
  return prefixOk && secretOk;
}

async function runStrategy(
  strategy: ContextStrategyId,
  workspace: string,
): Promise<StrategyResult> {
  const provider = resolveProvider({ provider: "deepseek" });
  const rt = await createRuntime({
    cwd: workspace,
    provider,
    contextStrategy: strategy,
    noSessionStore: true,
    allowBash: true,
    askWrite: false,
    // Tight enough that fold/trim strategies diverge on fat logs.
    maxContextTokens: 8_000,
    maxUserTurns: strategy === "trim" || strategy === "sticky-trim" ? 6 : undefined,
  });

  // Auto-allow tool permissions.
  const permissions = rt.permissions;
  if (permissions) {
    // workspace policy already has modes; runner ask goes through handler — force allow via wrap
  }

  let toolCalls = 0;
  let recallCalls = 0;
  const onEvent = (ev: RunEvent) => {
    if (ev.type === "tool_call") {
      toolCalls += 1;
      if (ev.toolCall.name === "recall_context") recallCalls += 1;
      process.stderr.write(`  [${strategy}] → ${ev.toolCall.name}\n`);
    }
  };

  const t0 = Date.now();
  let answer = "";
  try {
    for (let i = 0; i < TURNS.length; i++) {
      process.stderr.write(`  [${strategy}] turn ${i + 1}/${TURNS.length}\n`);
      const result = await rt.session.run(TURNS[i]!, {
        onEvent,
        maxTurns: 12,
        onPermissionAsk: async () => "allow",
      });
      answer = result.text ?? "";
    }
  } catch (err) {
    await rt.agent.dispose();
    return {
      strategy,
      ok: false,
      latencyMs: Date.now() - t0,
      turns: TURNS.length,
      toolCalls,
      recallCalls,
      canonicalTokens: estimateMessagesTokens([...rt.session.messages]),
      finalViewTokens: rt.session.lastAssemble?.estimatedTokens ?? 0,
      ratio: 0,
      foldedParts: rt.session.lastAssemble?.foldedParts ?? 0,
      stashedIds: rt.session.lastAssemble?.stashedIds?.length ?? 0,
      answer: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const canonicalTokens = estimateMessagesTokens([...rt.session.messages]);
  const finalViewTokens = rt.session.lastAssemble?.estimatedTokens ?? 0;
  const ratio = canonicalTokens > 0 ? finalViewTokens / canonicalTokens : 1;
  const ok = grade(answer);

  await rt.agent.dispose();

  return {
    strategy,
    ok,
    latencyMs: Date.now() - t0,
    turns: TURNS.length,
    toolCalls,
    recallCalls,
    canonicalTokens,
    finalViewTokens,
    ratio,
    foldedParts: rt.session.lastAssemble?.foldedParts ?? 0,
    stashedIds: rt.session.lastAssemble?.stashedIds?.length ?? 0,
    answer: answer.slice(0, 240),
  };
}

async function main() {
  loadEnv();
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error("DEEPSEEK_API_KEY missing");
    process.exit(1);
  }
  if (!process.env.PROVIDER || process.env.PROVIDER === "mock") {
    process.env.PROVIDER = "deepseek";
  }

  const only = process.argv
    .filter((a) => a.startsWith("--only="))
    .map((a) => a.slice("--only=".length) as ContextStrategyId);
  const strategies = only.length
    ? STRATEGIES.filter((s) => only.includes(s))
    : STRATEGIES;

  for (const s of strategies) {
    if (!CONTEXT_STRATEGY_IDS.includes(s)) {
      console.error(`Unknown strategy: ${s}`);
      process.exit(1);
    }
  }

  const base = mkdtempSync(path.join(os.tmpdir(), "min-ctx-eval-"));
  console.error(`workspace template: ${base}`);
  console.error(`provider: deepseek / ${process.env.DEEPSEEK_MODEL ?? "deepseek-flash"}`);
  console.error(`strategies: ${strategies.join(", ")}`);
  console.error(`secret=${SECRET} prefix=${PREFIX} maxContextTokens=8000\n`);

  const results: StrategyResult[] = [];
  for (const strategy of strategies) {
    const cwd = path.join(base, strategy);
    mkdirSync(cwd, { recursive: true });
    seedWorkspace(cwd);
    process.stderr.write(`\n=== ${strategy} ===\n`);
    const row = await runStrategy(strategy, cwd);
    results.push(row);
    process.stderr.write(
      `=> ok=${row.ok} view=${row.finalViewTokens} canon=${row.canonicalTokens} recall=${row.recallCalls} ${row.latencyMs}ms\n`,
    );
    process.stderr.write(`   answer: ${row.answer || row.error || "(empty)"}\n`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    task: "constraint + fat log needle recovery",
    provider: `deepseek:${process.env.DEEPSEEK_MODEL ?? "deepseek-flash"}`,
    maxContextTokens: 8_000,
    secret: SECRET,
    prefix: PREFIX,
    turns: TURNS.length,
    results,
  };

  const outFile = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "eval-live-results.json",
  );
  writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.error(`\nwrote ${outFile}`);

  // Cleanup temp trees (keep results json in repo example dir).
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const failed = results.filter((r) => !r.ok).length;
  process.exit(failed === results.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
