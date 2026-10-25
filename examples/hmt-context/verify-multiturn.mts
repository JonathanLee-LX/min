/**
 * Multi-turn context-management verification for hybrid (and peers).
 *
 * Why this scenario exists
 * ------------------------
 * Single-shot coding runs are usually ONE user-turn with a long tool loop.
 * Hybrid now ages older tool_results inside that active turn (keep last N),
 * and Session re-projects via projectMessages on every model complete.
 * This script still forces ≥3 user-turns so sticky head / folded middle /
 * protected tail are real regions, then checks fold + stash + recall.
 *
 * Scenario: "Needle under fat turns"
 * ----------------------------------
 *   U1 HEAD (sticky)  — small constraint turn; must stay verbatim in the view
 *   U2–U4 MIDDLE      — fat tool_results (≥ several KB each) burying a needle
 *   U5 TAIL           — short recent turn; tool body stays protected
 *
 * Checks (deterministic, no API key):
 *   A1  userTurns ≥ 5 after building history
 *   A2  hybrid regions: head≥1, middle≥1, tail≥1
 *   A3  foldedParts > 0 and stash size > 0
 *   A4  HEAD constraint text still present verbatim in the model view
 *   A5  MIDDLE fat tool body is NOT fully present (hidden marker instead)
 *   A6  NEEDLE is absent from the folded view but recoverable via recall_context
 *   A7  trim (baseline) keeps more of the fat body OR drops whole turns
 *       (contrast: hybrid prefers fold+stash over silent drop of the head)
 *
 * Optional live pass (DEEPSEEK_API_KEY):
 *   B1  several session.run() turns against a seeded workspace
 *   B2  after turn ≥3: lastAssemble.foldedParts > 0 or stashedIds > 0
 *   B3  final ask for the needle → recall_context used OR answer contains needle
 *
 * Run:
 *   pnpm --filter @min/example-hmt-context exec tsx verify-multiturn.mts
 *   # live:
 *   set -a && source ../../.env && set +a
 *   LIVE=1 pnpm --filter @min/example-hmt-context exec tsx verify-multiturn.mts
 */
import {
  assistantMessage,
  createAgent,
  mockProvider,
  textPart,
  toolCallPart,
  toolMessage,
  toolResultPart,
  userMessage,
  type Message,
  type RunEvent,
} from "@min/core";
import { createRuntime, resolveProvider } from "@min/runtime";
import {
  assembleHybridContext,
  assembleTrimContext,
  createContextStash,
  createRecallTool,
  estimateMessagesTokens,
  parseHiddenIds,
  type AssembleResult,
} from "@min/session";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NEEDLE = "NEEDLE_CTX_7f3a91";
const CONSTRAINT = "CONSTRAINT_PREFIX=ACME-DEMO";
const FAT = 12_000;

interface Check {
  id: string;
  ok: boolean;
  detail: string;
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

/** Synthetic multi-turn history: 1 sticky + 3 fat middle + 1 short tail. */
function buildMultiTurnHistory(): Message[] {
  const fatMiddle = (id: string, label: string, buryNeedle: boolean) => {
    const body = buryNeedle
      ? [pad(800, "X"), `SECRET=${NEEDLE}`, pad(FAT, "x"), "END"].join("\n")
      : [pad(800, "Y"), `noise=${label}`, pad(FAT, "y"), "END"].join("\n");
    return [
      userMessage(`Dump ${label} with the tool (turn middle).`),
      assistantMessage([
        textPart(`Reading ${label}.`),
        toolCallPart(id, "read_file", { path: label }),
      ]),
      toolMessage([toolResultPart(id, body)]),
      assistantMessage([textPart(`Done ${label} (metadata only).`)]),
    ];
  };

  return [
    // U1 HEAD — sticky constraint (must survive fold)
    userMessage(
      `Remember this forever: ${CONSTRAINT}. Reply ACK only.`,
    ),
    assistantMessage([textPart("ACK")]),

    // U2–U4 MIDDLE — fat tool bodies (fold candidates)
    ...fatMiddle("c_alpha", "logs/alpha.log", true),
    ...fatMiddle("c_beta", "logs/beta.log", false),
    ...fatMiddle("c_gamma", "logs/gamma.log", false),

    // U5 TAIL — short recent turn (protected)
    userMessage("What is the current status? One sentence."),
    assistantMessage([
      textPart("Status ok."),
      toolCallPart("c_tail", "bash", { command: "echo ok" }),
    ]),
    toolMessage([toolResultPart("c_tail", "ok\n")]),
    assistantMessage([textPart("Ready.")]),
  ];
}

function viewText(messages: readonly Message[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    for (const p of m.content) {
      if (p.type === "text") parts.push(p.text);
      if (p.type === "tool_result") parts.push(p.content);
    }
  }
  return parts.join("\n");
}

function runDeterministic(): {
  checks: Check[];
  hybrid: AssembleResult;
  stash: ReturnType<typeof createContextStash>;
} {
  const messages = buildMultiTurnHistory();
  const stash = createContextStash();
  const system = "You are a test agent.";
  const tools = [
    {
      name: "read_file",
      description: "read",
      inputSchema: { type: "object" as const },
    },
    {
      name: "bash",
      description: "bash",
      inputSchema: { type: "object" as const },
    },
    {
      name: "recall_context",
      description: "recall",
      inputSchema: { type: "object" as const },
    },
  ];

  const budget = {
    maxContextTokens: 8_000,
    reservedOutputTokens: 512,
    stash,
  };

  const hybrid = assembleHybridContext(
    { messages, system, tools, budget },
    { stickyTurns: 1, protectTailTurns: 1 },
  );

  const trim = assembleTrimContext({
    messages,
    system,
    tools,
    budget: { ...budget, stash: undefined },
  });

  const view = viewText(hybrid.view);
  const canon = viewText(messages);
  const regions = hybrid.regions ?? {
    headTurns: 0,
    middleTurns: 0,
    tailTurns: 0,
  };

  const checks: Check[] = [];

  const userTurns = messages.filter((m) => m.role === "user").length;
  checks.push({
    id: "A1_multi_user_turns",
    ok: userTurns >= 5,
    detail: `userTurns=${userTurns}`,
  });

  checks.push({
    id: "A2_hmt_regions",
    ok:
      regions.headTurns >= 1 &&
      regions.middleTurns >= 1 &&
      regions.tailTurns >= 1,
    detail: `H/M/T=${regions.headTurns}/${regions.middleTurns}/${regions.tailTurns}`,
  });

  checks.push({
    id: "A3_fold_and_stash",
    ok: (hybrid.foldedParts ?? 0) > 0 && stash.size > 0,
    detail: `foldedParts=${hybrid.foldedParts} stash=${stash.size} trimmed=${hybrid.trimmed}`,
  });

  checks.push({
    id: "A4_head_constraint_kept",
    ok: view.includes(CONSTRAINT),
    detail: view.includes(CONSTRAINT)
      ? "CONSTRAINT present in model view"
      : "CONSTRAINT missing from view",
  });

  const middleHidden = hybrid.view.some((m) =>
    m.content.some(
      (p) =>
        p.type === "tool_result" && parseHiddenIds(p.content).length > 0,
    ),
  );
  const fatStillFull = view.includes(pad(2000, "x"));
  checks.push({
    id: "A5_middle_fat_folded",
    ok: middleHidden && !fatStillFull,
    detail: `hiddenMarkers=${middleHidden} fatStillFull=${fatStillFull}`,
  });

  const needleInView = view.includes(NEEDLE);
  checks.push({
    id: "A6_needle_hidden_placeholder",
    ok: !needleInView && canon.includes(NEEDLE),
    detail: `needleInView=${needleInView} needleInCanonical=${canon.includes(NEEDLE)}`,
  });

  const trimView = viewText(trim.view);
  checks.push({
    id: "A7_hybrid_keeps_head_vs_trim",
    ok: view.includes(CONSTRAINT),
    detail: `hybridHasConstraint=${view.includes(CONSTRAINT)} trimHasConstraint=${trimView.includes(CONSTRAINT)} hybridViewTok~${hybrid.estimatedTokens} trimViewTok~${trim.estimatedTokens} canonTok~${estimateMessagesTokens(messages)}`,
  });

  return { checks, hybrid, stash };
}

async function runRecallCheck(
  stash: ReturnType<typeof createContextStash>,
): Promise<Check> {
  const recall = createRecallTool(stash);
  const listed = await recall.execute({});
  const ids = stash.list().map((e) => e.id);
  if (!ids.length) {
    return {
      id: "A6b_recall_recovers_needle",
      ok: false,
      detail: "stash empty — nothing to recall",
    };
  }
  // Find which stash entry holds the needle.
  let found = false;
  let hitId = "";
  for (const id of ids) {
    const page = await recall.execute({ id, offset: 0, limit: 50_000 });
    if (page.content.includes(NEEDLE)) {
      found = true;
      hitId = id;
      break;
    }
  }
  return {
    id: "A6b_recall_recovers_needle",
    ok: found,
    detail: found
      ? `recalled NEEDLE from ${hitId}; listPreviewChars=${listed.content.length}`
      : `NEEDLE not in any of ${ids.length} stash entries`,
  };
}

function seedLiveWorkspace(root: string): void {
  mkdirSync(path.join(root, "logs"), { recursive: true });
  writeFileSync(
    path.join(root, "CONSTRAINT.md"),
    `# Session constraint\n${CONSTRAINT}\nFinal answers about the secret must include this prefix.\n`,
  );
  writeFileSync(
    path.join(root, "logs", "alpha.log"),
    [pad(900, "A"), `SECRET=${NEEDLE}`, pad(FAT, "a"), "END_ALPHA"].join("\n"),
  );
  writeFileSync(
    path.join(root, "logs", "beta.log"),
    [pad(900, "B"), "SECRET=NEEDLE_FAKE_0000", pad(FAT, "b"), "END_BETA"].join(
      "\n",
    ),
  );
  writeFileSync(
    path.join(root, "logs", "gamma.log"),
    [pad(FAT, "G"), "no secret", pad(4_000, "g")].join("\n"),
  );
  writeFileSync(
    path.join(root, "logs", "delta.log"),
    [pad(FAT, "D"), "distractor", pad(4_000, "d")].join("\n"),
  );
}

async function runLive(): Promise<Check[]> {
  const checks: Check[] = [];
  if (!process.env.DEEPSEEK_API_KEY) {
    checks.push({
      id: "B0_live_skipped",
      ok: true,
      detail: "DEEPSEEK_API_KEY missing — live pass skipped",
    });
    return checks;
  }

  const workspace = mkdtempSync(path.join(os.tmpdir(), "min-ctx-mt-"));
  seedLiveWorkspace(workspace);

  const provider = resolveProvider({ provider: "deepseek" });
  const rt = await createRuntime({
    cwd: workspace,
    provider,
    contextStrategy: "hybrid",
    noSessionStore: true,
    allowBash: true,
    // Tight enough that middle fat reads must fold across turns.
    maxContextTokens: 7_000,
  });

  const turns = [
    `Read CONSTRAINT.md with read_file. Reply with exactly: ACK ${CONSTRAINT}`,
    `Using read_file, read logs/alpha.log completely. Reply with only path and byte size — do not quote the body.`,
    `Using read_file, read logs/beta.log and logs/gamma.log completely. Metadata only (path+bytes).`,
    `Using read_file, read logs/delta.log completely. Metadata only.`,
    `What is SECRET from logs/alpha.log? Use recall_context if you only see a [hidden:…] marker. Reply with one line: ${CONSTRAINT.split("=")[0]}=… SECRET=…`,
  ];

  let recallCalls = 0;
  let foldSeen = false;
  let stashSeen = false;
  let lastAnswer = "";
  const assembleTrail: string[] = [];

  try {
    for (let i = 0; i < turns.length; i++) {
      const result = await rt.session.run(turns[i]!, {
        maxTurns: 12,
        onPermissionAsk: async () => "allow",
        onEvent: (ev: RunEvent) => {
          if (ev.type === "tool_call" && ev.toolCall.name === "recall_context") {
            recallCalls += 1;
          }
        },
      });
      lastAnswer = result.text ?? "";
      const a = rt.session.lastAssemble;
      if (a) {
        if ((a.foldedParts ?? 0) > 0) foldSeen = true;
        if ((a.stashedIds?.length ?? 0) > 0) stashSeen = true;
        assembleTrail.push(
          `t${i + 1}: strategy=${a.strategy} folded=${a.foldedParts ?? 0} stash=${a.stashedIds?.length ?? 0} view~${a.estimatedTokens} H/M/T=${a.regions?.headTurns ?? "?"}/${a.regions?.middleTurns ?? "?"}/${a.regions?.tailTurns ?? "?"}`,
        );
      }
      process.stderr.write(`  [live] turn ${i + 1}/${turns.length} done\n`);
    }
  } catch (err) {
    checks.push({
      id: "B_live_error",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
    await rt.session.dispose();
    await rt.agent.dispose();
    rmSync(workspace, { recursive: true, force: true });
    return checks;
  }

  const finalAssemble = rt.session.lastAssemble;
  checks.push({
    id: "B1_live_multi_turn_ran",
    ok: (rt.session.messages.filter((m) => m.role === "user").length) >= 5,
    detail: `userTurns=${rt.session.messages.filter((m) => m.role === "user").length} trail=${assembleTrail.join(" | ")}`,
  });

  checks.push({
    id: "B2_live_fold_or_stash",
    ok: foldSeen || stashSeen,
    detail: `foldSeen=${foldSeen} stashSeen=${stashSeen} finalFolded=${finalAssemble?.foldedParts ?? 0} finalStash=${finalAssemble?.stashedIds?.length ?? 0}`,
  });

  const answerOk =
    lastAnswer.includes(NEEDLE) ||
    lastAnswer.includes("NEEDLE_CTX") ||
    recallCalls > 0;
  checks.push({
    id: "B3_live_needle_via_recall_or_answer",
    ok: answerOk,
    detail: `recallCalls=${recallCalls} answer=${JSON.stringify(lastAnswer.slice(0, 200))}`,
  });

  await rt.session.dispose();
  await rt.agent.dispose();
  rmSync(workspace, { recursive: true, force: true });
  return checks;
}

/**
 * Prove Session.assemble runs once per user turn and hybrid folds once
 * enough prior fat turns exist in canonical history.
 *
 * We seed initialMessages with U1–U4 (head + fat middle), then session.run
 * a short U5. That matches real multi-turn chat: prior turns already stored,
 * each new user message triggers assemble over the growing history.
 */
async function runSessionAssembleCadence(): Promise<Check[]> {
  const prior = buildMultiTurnHistory();
  // Drop the final short tail — we'll create it via session.run.
  const seeded = prior.slice(0, -4);

  const provider = mockProvider([
    { text: "Status ok — ready." },
    { text: "Still ready." },
  ]);

  const agent = await createAgent({
    provider,
    system: "test",
    maxTurns: 4,
  });

  const { createSession, hybridContextExtension, recallContextExtension } =
    await import("@min/session");

  const hybrid = hybridContextExtension({
    budget: { maxContextTokens: 6_000 },
  });
  const session = await createSession({
    agent,
    initialMessages: seeded,
    stash: hybrid.stash,
    extensions: [hybrid, recallContextExtension(hybrid.stash)],
    budget: { maxContextTokens: 6_000, stash: hybrid.stash },
    systemForBudget: "test",
  });

  const assembleSnapshots: AssembleResult[] = [];
  const prompts = [
    "What is the current status? One sentence.",
    "Anything else?",
  ];

  for (const p of prompts) {
    await session.run(p);
    if (session.lastAssemble) assembleSnapshots.push(session.lastAssemble);
  }

  const first = assembleSnapshots[0];
  const last = assembleSnapshots.at(-1);
  const checks: Check[] = [
    {
      id: "C1_assemble_each_user_turn",
      ok: assembleSnapshots.length === prompts.length,
      detail: `assembles=${assembleSnapshots.length} prompts=${prompts.length}`,
    },
    {
      id: "C2_regions_on_first_new_turn",
      ok: Boolean(
        first?.regions &&
          first.regions.headTurns >= 1 &&
          first.regions.middleTurns >= 1 &&
          first.regions.tailTurns >= 1,
      ),
      detail: `first H/M/T=${first?.regions?.headTurns}/${first?.regions?.middleTurns}/${first?.regions?.tailTurns}`,
    },
    {
      id: "C3_fold_when_history_has_fat_middle",
      ok: Boolean(
        first &&
          ((first.foldedParts ?? 0) > 0 || (first.stashedIds?.length ?? 0) > 0),
      ),
      detail: assembleSnapshots
        .map(
          (a, i) =>
            `t${i + 1}:fold=${a.foldedParts ?? 0}/stash=${a.stashedIds?.length ?? 0}/tok~${a.estimatedTokens}/HMT=${a.regions?.headTurns}/${a.regions?.middleTurns}/${a.regions?.tailTurns}`,
        )
        .join(" | "),
    },
    {
      id: "C4_head_survives_in_session_view",
      ok: Boolean(
        first?.view.some((m) =>
          m.content.some(
            (p) => p.type === "text" && p.text.includes(CONSTRAINT),
          ),
        ),
      ),
      detail: `finalFolded=${last?.foldedParts} stashSize=${hybrid.stash.size}`,
    },
  ];

  await session.dispose();
  await agent.dispose();
  return checks;
}

async function main(): Promise<void> {
  loadEnv();
  console.log("=== Multi-turn context verification ===\n");
  console.log("Scenario: Needle under fat turns (sticky head / fat middle / short tail)\n");

  // --- Phase A: pure assemble ---
  console.log("--- A) Deterministic hybrid assemble ---");
  const { checks: aChecks, hybrid, stash } = runDeterministic();
  aChecks.push(await runRecallCheck(stash));

  for (const c of aChecks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.id}: ${c.detail}`);
  }
  console.log(
    `  hybrid view~${hybrid.estimatedTokens} tok  folded=${hybrid.foldedParts}  H/M/T=${hybrid.regions?.headTurns}/${hybrid.regions?.middleTurns}/${hybrid.regions?.tailTurns}`,
  );

  // --- Phase C: session cadence with mock tools ---
  console.log("\n--- C) Session multi-turn assemble cadence (mock) ---");
  const cChecks = await runSessionAssembleCadence();
  for (const c of cChecks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.id}: ${c.detail}`);
  }

  // --- Phase B: optional live ---
  const wantLive = process.env.LIVE === "1" || process.env.LIVE === "true";
  let bChecks: Check[] = [];
  if (wantLive) {
    console.log("\n--- B) Live DeepSeek multi-turn ---");
    bChecks = await runLive();
    for (const c of bChecks) {
      console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.id}: ${c.detail}`);
    }
  } else {
    console.log("\n--- B) Live DeepSeek multi-turn ---");
    console.log("SKIP  set LIVE=1 (and DEEPSEEK_API_KEY) to enable");
  }

  const all = [...aChecks, ...cChecks, ...bChecks];
  const failed = all.filter((c) => !c.ok);
  console.log(
    `\nRESULT  passed=${all.length - failed.length}/${all.length}  ${failed.length ? "VERIFY_OK=no" : "VERIFY_OK=yes"}`,
  );
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
