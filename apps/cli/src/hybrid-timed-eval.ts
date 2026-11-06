import { createAutoPermissionApprover, createClient } from "@min-agent/client";
import type { ModelProvider } from "@min-agent/core";
import { resolveProvider } from "@min-agent/runtime";

const cwd = process.argv[2];
const maxContextTokens = Number(process.argv[3] ?? 256000);
const maxTurns = Number(process.argv[4] ?? 25);
const tokenSkill = process.argv[5] ?? "min-eval-skill-7f3c";
const tokenScript = process.argv[6] ?? "min-eval-script-9a2b";
if (!cwd) {
  console.error("usage: hybrid-timed-eval.ts <cwd> [maxContextTokens] [maxTurns]");
  process.exit(2);
}

const prompt = [
  "Read SKILL.md with read_file, then read clean_disk.py with read_file,",
  "then run python3 clean_disk.py --dry-run, then ls -la, then pwd.",
  "Do not cat, sed, head, or tail those two files via bash.",
  "TOKEN_SKILL and TOKEN_SCRIPT are NOT in the first 12000 characters of either file.",
  "recall_context default limit is 12000 from offset 0.",
  "If a recalled page does not contain the token, call recall_context again",
  "with the same id and offset=12000.",
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
  const recallOffsets: number[] = [];
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
      if (event.name === "recall_context") {
        const off = event.args?.offset;
        recallOffsets.push(typeof off === "number" ? off : 0);
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
  await client.dispose();

  const counts: Record<string, number> = {};
  for (const name of tools) counts[name] = (counts[name] ?? 0) + 1;

  const quotedSkillToken = text.includes(tokenSkill);
  const quotedScriptToken = text.includes(tokenScript);
  const payload = {
    elapsedMs,
    modelCalls: acc.modelCalls,
    toolCallTotal: tools.length,
    toolCalls: counts,
    recallContextCount: counts.recall_context ?? 0,
    recallOffsets,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    costUsdPeak: Number(costUsd(acc.inputTokens, acc.outputTokens, true).toFixed(6)),
    costUsdOffPeak: Number(costUsd(acc.inputTokens, acc.outputTokens, false).toFixed(6)),
    billingWindow: peak ? "peak" : "off-peak",
    quotedSkillToken,
    quotedScriptToken,
    completedTask: quotedSkillToken && quotedScriptToken,
    maxContextTokens,
    provider: provider.id,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.completedTask) process.exitCode = 3;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
