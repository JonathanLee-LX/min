import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createAutoPermissionApprover, createClient } from "@min-agent/client";
import type { ModelProvider } from "@min-agent/core";
import { resolveProvider } from "@min-agent/runtime";

const cwdArg = process.argv[2];
const maxContextTokens = Number(process.argv[3] ?? 256000);
const maxTurns = Number(process.argv[4] ?? 25);
const tokenSkill = process.argv[5] ?? "min-eval-skill-7f3c";
const tokenScript = process.argv[6] ?? "min-eval-script-9a2b";
if (!cwdArg) {
  console.error("usage: hybrid-timed-eval.ts <cwd> [maxContextTokens] [maxTurns]");
  process.exit(2);
}
const cwd: string = cwdArg;

const recovery = process.env.HYBRID_EVAL_RECOVERY ?? "either";
const recoveryLine =
  recovery === "recall"
    ? "If a tool result contains [hidden:<id> · recall_context], call recall_context for that id to recover the token."
    : recovery === "rg"
      ? "If a tool result contains [hidden:<id> · recall_context · file=<path>], search that spilled file with rg -n -C 2 -F <NAME> <path>. Do not read_file the spilled file. Do not cat, sed, head, or tail it."
      : "If a tool result contains [hidden:<id> · recall_context], recover the token with either recall_context need={kind,query} or, when file= is present, rg -n -C 2 -F <NAME> <path>. Use one. Do not read_file the spilled file.";
const prompt = [
  "Read SKILL.md with read_file, then read clean_disk.py with read_file,",
  "then run python3 clean_disk.py --dry-run, then ls -la, then pwd.",
  "Do not cat, sed, head, or tail those two files via bash.",
  "TOKEN_SKILL and TOKEN_SCRIPT are NOT in the first or last 120 characters",
  "of either file.",
  recoveryLine,
  "Quote both exact token values in the final answer.",
  "Do not write or delete files.",
].join(" ");

type Acc = { inputTokens: number; outputTokens: number; modelCalls: number };

function wrapUsage(provider: ModelProvider, acc: Acc): ModelProvider {
  const complete = provider.complete.bind(provider);
  const stream = provider.stream?.bind(provider);
  provider.complete = async (req) => {
    const result = await complete(req);
    acc.inputTokens += result.usage?.inputTokens ?? 0;
    acc.outputTokens += result.usage?.outputTokens ?? 0;
    acc.modelCalls += 1;
    return result;
  };
  if (stream) {
    provider.stream = async function* (req) {
      for await (const chunk of stream(req)) {
        if (chunk.type === "done") {
          acc.modelCalls += 1;
          acc.inputTokens += chunk.result?.usage?.inputTokens ?? 0;
          acc.outputTokens += chunk.result?.usage?.outputTokens ?? 0;
        }
        yield chunk;
      }
    };
  }
  return provider;
}

function costUsd(input: number, output: number, peak: boolean) {
  const inRate = peak ? 0.3 : 0.15;
  const outRate = peak ? 1.2 : 0.6;
  return (input * inRate + output * outRate) / 1_000_000;
}

async function main(): Promise<void> {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay();
  const peak =
    utcDay >= 1 &&
    utcDay <= 5 &&
    ((utcHour >= 1 && utcHour < 4) || (utcHour >= 6 && utcHour < 10));

  const acc: Acc = { inputTokens: 0, outputTokens: 0, modelCalls: 0 };
  const tools: string[] = [];
  const bashCommands: string[] = [];
  const recallOffsets: number[] = [];
  const recallIds: string[] = [];
  const recallNeeds: Array<string | null> = [];
  const recallModes: string[] = [];
  const recallResultChars: number[] = [];
  const pendingRecall = new Map<
    string,
    { offset: number; need: string | null }
  >();
  const pendingRg = new Set<string>();
  const rgResultChars: number[] = [];
  let text = "";

  const provider = wrapUsage(
    resolveProvider({ provider: "deepseek", reasoningEffort: "none" }),
    acc,
  );

  const client = await createClient({
    cwd,
    provider,
    noSessionStore: true,
    allowBash: true,
    maxContextTokens,
    maxTurns,
    contextStrategy: "hybrid",
    autoApprovePermission: createAutoPermissionApprover({
      mode: "auto",
      allowRootGrant: true,
    }),
  });

  client.subscribe((event) => {
    if (event.type === "tool_start") {
      tools.push(event.name);
      if (event.name === "bash" && typeof event.args?.command === "string") {
        bashCommands.push(event.args.command);
        if (/^\s*rg\b/.test(event.args.command)) pendingRg.add(event.toolCallId);
      }
      if (event.name === "recall_context") {
        const off = event.args?.offset;
        const offset = typeof off === "number" ? off : 0;
        recallOffsets.push(offset);
        const id = event.args?.id;
        if (typeof id === "string") recallIds.push(id);
        const need = event.args?.need;
        let needLabel: string | null = null;
        if (need && typeof need === "object") {
          const record = need as { kind?: unknown; query?: unknown };
          needLabel = `${String(record.kind ?? "")}:${String(record.query ?? "")}`;
        }
        recallNeeds.push(needLabel);
        pendingRecall.set(event.toolCallId, { offset, need: needLabel });
      }
    }
    if (event.type === "tool_end") {
      if (pendingRg.delete(event.toolCallId)) rgResultChars.push(event.content.length);
      const pending = pendingRecall.get(event.toolCallId);
      if (pending) {
        pendingRecall.delete(event.toolCallId);
        recallResultChars.push(event.content.length);
        const mode = /(?:^|\s)mode=(\w+)/.exec(event.content);
        recallModes.push(mode?.[1] ?? "page");
      }
    }
    if (event.type === "assistant_delta") text += event.text;
    if (event.type === "assistant_done" && event.text) {
      if (!text.includes(event.text)) text += event.text;
    }
  });

  const t0 = Date.now();
  await client.send(prompt);
  const elapsedMs = Date.now() - t0;
  const spilledFiles = listSpilled(cwd);
  await client.dispose();

  const counts: Record<string, number> = {};
  for (const name of tools) counts[name] = (counts[name] ?? 0) + 1;

  const quotedSkillToken = text.includes(tokenSkill);
  const quotedScriptToken = text.includes(tokenScript);
  const idCounts: Record<string, number> = {};
  for (const id of recallIds) idCounts[id] = (idCounts[id] ?? 0) + 1;
  const maxSameRecallId = Object.values(idCounts).reduce((a, b) => Math.max(a, b), 0);
  const oneRecallPass =
    quotedSkillToken &&
    quotedScriptToken &&
    (counts.recall_context ?? 0) >= 1 &&
    recallOffsets.every((off) => off === 0) &&
    maxSameRecallId <= 1;
  const payload = {
    elapsedMs,
    modelCalls: acc.modelCalls,
    toolCallTotal: tools.length,
    toolCalls: counts,
    bashCommands,
    rgCount: bashCommands.filter((command) => /^\s*rg\b/.test(command)).length,
    rgResultChars,
    rgResultCharsTotal: rgResultChars.reduce((sum, n) => sum + n, 0),
    spilledFiles,
    recallContextCount: counts.recall_context ?? 0,
    recallOffsets,
    recallNeeds,
    recallModes,
    recallResultChars,
    recallResultCharsTotal: recallResultChars.reduce((sum, n) => sum + n, 0),
    maxSameRecallId,
    oneRecallPass,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    costUsdPeak: Number(costUsd(acc.inputTokens, acc.outputTokens, true).toFixed(6)),
    costUsdOffPeak: Number(costUsd(acc.inputTokens, acc.outputTokens, false).toFixed(6)),
    billingWindow: peak ? "peak" : "off-peak",
    quotedSkillToken,
    quotedScriptToken,
    completedTask: quotedSkillToken && quotedScriptToken,
    recovery,
    maxContextTokens,
    provider: provider.id,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.completedTask) process.exitCode = 3;
}

function listSpilled(root: string): string[] {
  const sessions = path.join(root, ".min", "sessions");
  const found: string[] = [];
  const walk = (dir: string) => {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = path.join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs);
      else if (name.endsWith(".txt")) found.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  walk(sessions);
  return found;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
