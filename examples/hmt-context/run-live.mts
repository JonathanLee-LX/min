/**
 * Live H-M-T + recall_context against a real provider (DeepSeek from .env).
 *
 * Usage (from repo root):
 *   set -a && source .env && set +a
 *   pnpm --filter @min-agent/example-hmt-context exec tsx run-live.mts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assistantMessage,
  createAgent,
  textPart,
  toolCallPart,
  toolMessage,
  toolResultPart,
  userMessage,
  type Message,
  type RunEvent,
} from "@min-agent/core";
import { resolveProvider } from "@min-agent/runtime";
import {
  createSession,
  estimateMessagesTokens,
  hmtContextExtension,
  parseHiddenIds,
  recallContextExtension,
} from "@min-agent/session";

const MARKER = "NEEDLE_42_SECRET";

function loadEnvFromRepoRoot(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "../../.env");
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function buildHistory(): Message[] {
  const msgs: Message[] = [];
  msgs.push(userMessage("Constraint: always prefer relative paths under src/."));
  msgs.push(assistantMessage([textPart("Understood. Will prefer src/ paths.")]));

  for (let i = 0; i < 4; i++) {
    const id = `mid_${i}`;
    const body =
      i === 1
        ? "M".repeat(400) + `\n${MARKER}\n` + "M".repeat(17_600)
        : "M".repeat(18_000);
    msgs.push(userMessage(`middle task ${i}: inspect blob`));
    msgs.push(
      assistantMessage([
        toolCallPart(id, "bash", { command: `cat blob_${i}.txt` }),
      ]),
    );
    msgs.push(toolMessage([toolResultPart(id, body)]));
  }

  msgs.push(userMessage("tail: what is the next step?"));
  msgs.push(
    assistantMessage([
      textPart("Next: open the module under src/ and wire the handler."),
    ]),
  );
  return msgs;
}

async function main() {
  loadEnvFromRepoRoot();

  if (!process.env.DEEPSEEK_API_KEY && !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.error("No provider API key in env / .env");
    process.exit(1);
  }

  // Force a real provider even if PROVIDER=mock in .env
  if (!process.env.PROVIDER || process.env.PROVIDER === "mock") {
    process.env.PROVIDER = process.env.DEEPSEEK_API_KEY
      ? "deepseek"
      : process.env.OPENAI_API_KEY
        ? "openai"
        : "anthropic";
  }

  const provider = resolveProvider({});
  console.log(`=== Live H-M-T smoke ===`);
  console.log(`provider=${provider.id}\n`);

  const history = buildHistory();
  const hmt = hmtContextExtension({
    budget: {
      maxContextTokens: 12_000,
      reservedOutputTokens: 1024,
      headTurns: 1,
      tailTurns: 1,
      fold: {
        maxToolResultChars: 1200,
        toolResultHeadChars: 200,
        toolResultTailChars: 200,
      },
    },
  });
  const stash = hmt.stash;

  const pre = await hmt.assembler!.assemble({
    messages: history,
    budget: {
      maxContextTokens: 12_000,
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

  console.log(
    `pre-assemble H/M/T=${pre.regions?.headTurns}/${pre.regions?.middleTurns}/${pre.regions?.tailTurns} folded=${pre.foldedParts} viewTokens≈${pre.estimatedTokens} (canonical≈${estimateMessagesTokens(history)})`,
  );
  const hidden: string[] = [];
  for (const m of pre.view) {
    for (const p of m.content) {
      if (p.type === "tool_result") hidden.push(...parseHiddenIds(p.content));
    }
  }
  console.log(`hidden ids: ${hidden.join(", ")}`);
  console.log(
    `NEEDLE in view before run: ${
      pre.view.some((m) =>
        m.content.some(
          (p) =>
            p.type === "tool_result" && p.content.includes(MARKER),
        ),
      )
        ? "yes"
        : "no"
    }`,
  );

  const agent = await createAgent({
    provider,
    extensions: [recallContextExtension(stash)],
    system: [
      "You are a careful coding agent.",
      "Older tool outputs may be folded as …[hidden:<id> · recall_context]…",
      "When you need omitted content, call recall_context with that id.",
      "Reply with a short final answer after tools.",
    ].join(" "),
    maxTurns: 6,
  });

  const session = await createSession({
    agent,
    stash,
    extensions: [hmt],
    initialMessages: history,
    budget: {
      maxContextTokens: 12_000,
      reservedOutputTokens: 1024,
    },
  });

  const toolLog: string[] = [];
  const onEvent = (ev: RunEvent) => {
    if (ev.type === "tool_call") {
      toolLog.push(
        `call ${ev.toolCall.name}(${JSON.stringify(ev.toolCall.arguments)})`,
      );
      console.log(`→ ${toolLog.at(-1)}`);
    } else if (ev.type === "tool_result") {
      const preview = ev.content.slice(0, 120).replace(/\n/g, "\\n");
      toolLog.push(`result ${ev.toolCallId} ok=${!ev.isError} ${preview}…`);
      console.log(`← ${toolLog.at(-1)}`);
    } else if (ev.type === "text_delta") {
      process.stdout.write(ev.text);
    }
  };

  console.log("\n--- model turn ---\n");
  const t0 = Date.now();
  const result = await session.run(
    [
      "In an earlier middle bash tool result there was a secret marker string",
      `exactly equal to ${MARKER}.`,
      "It is no longer fully visible in your context because middle tool output was folded.",
      "Use recall_context on the appropriate hidden id (list first if unsure),",
      "then reply with a single line: FOUND:<marker>",
    ].join(" "),
    { onEvent, maxTurns: 6 },
  );
  const ms = Date.now() - t0;
  console.log("\n");

  const recalled = result.messages.some(
    (m) =>
      m.role === "tool" &&
      m.content.some(
        (p) => p.type === "tool_result" && p.content.includes(MARKER),
      ),
  );
  const usedRecall = toolLog.some((l) => l.includes("recall_context"));
  const answered =
    (result.text ?? "").includes(MARKER) ||
    (result.text ?? "").includes("FOUND:");

  console.log("--- outcome ---");
  console.log(`latency_ms=${ms}`);
  console.log(`used recall_context: ${usedRecall ? "PASS" : "FAIL"}`);
  console.log(`tool returned NEEDLE: ${recalled ? "PASS" : "FAIL"}`);
  console.log(`assistant mentioned marker/FOUND: ${answered ? "PASS" : "FAIL"}`);
  console.log(`assistant text: ${(result.text ?? "").slice(0, 400)}`);
  console.log(
    `lastAssemble H/M/T=${session.lastAssemble?.regions?.headTurns}/${session.lastAssemble?.regions?.middleTurns}/${session.lastAssemble?.regions?.tailTurns} folded=${session.lastAssemble?.foldedParts} viewTokens≈${session.lastAssemble?.estimatedTokens}`,
  );

  await agent.dispose();

  const failed = !usedRecall || !recalled || !answered;
  console.log(`\n=== ${failed ? "FAILED" : "ALL CHECKS PASSED"} ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
