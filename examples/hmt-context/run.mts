/**
 * Live smoke of H-M-T context + recall_context (offline mock).
 *
 * Shows:
 * 1) Head stable across turns (prefix-cache friendly)
 * 2) Middle tool_results folded with stash ids
 * 3) Tail left verbatim
 * 4) Model recalls a hidden payload via recall_context
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
} from "@min/core";
import {
  assembleContext,
  createContextStash,
  createSession,
  estimateMessagesTokens,
  parseHiddenIds,
  recallContextExtension,
} from "@min/session";

const MARKER = "NEEDLE_42_SECRET";

function buildHistory(): Message[] {
  const msgs: Message[] = [];

  // Head — early constraint (should stay verbatim)
  msgs.push(userMessage("Constraint: always prefer relative paths under src/."));
  msgs.push(assistantMessage([textPart("Understood. Will prefer src/ paths.")]));

  // Middle — several fat tool turns (fold candidates)
  for (let i = 0; i < 4; i++) {
    const id = `mid_${i}`;
    // Put NEEDLE in the omitted middle (past headChars=200) so view loses it.
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

  // Tail — recent work (should stay full)
  msgs.push(userMessage("tail: what is the next step?"));
  msgs.push(
    assistantMessage([
      textPart("Next: open the module under src/ and wire the handler."),
    ]),
  );

  return msgs;
}

function summarizeView(label: string, view: Message[]) {
  const roles = view.map((m) => m.role).join(",");
  const toolLens = view
    .filter((m) => m.role === "tool")
    .map((m) => {
      const p = m.content[0];
      return p?.type === "tool_result" ? p.content.length : 0;
    });
  console.log(`\n[${label}]`);
  console.log(`  msgs=${view.length} roles=${roles}`);
  console.log(`  tool_result chars in view: [${toolLens.join(", ")}]`);
  console.log(`  est tokens≈${estimateMessagesTokens(view)}`);
}

async function main() {
  console.log("=== H-M-T context strategy smoke ===\n");

  const history = buildHistory();
  const canonicalChars = history
    .flatMap((m) => m.content)
    .reduce((n, p) => {
      if (p.type === "tool_result") return n + p.content.length;
      if (p.type === "text") return n + p.text.length;
      return n;
    }, 0);

  console.log(
    `canonical: ${history.length} msgs, tool/text chars≈${canonicalChars}, tokens≈${estimateMessagesTokens(history)}`,
  );

  const stash = createContextStash();
  const assembled = assembleContext({
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

  console.log("\n--- assemble ---");
  console.log(
    `regions H/M/T = ${assembled.regions?.headTurns}/${assembled.regions?.middleTurns}/${assembled.regions?.tailTurns}`,
  );
  console.log(
    `trimmed=${assembled.trimmed} foldedParts=${assembled.foldedParts} stashIds=${assembled.stashedIds?.join(",") ?? "—"}`,
  );
  console.log(
    `view tokens≈${assembled.estimatedTokens} (messageBudget=${assembled.messageBudget})`,
  );
  console.log(
    `canonical unchanged: kept===input ${assembled.kept === history}, dropped=${assembled.dropped.length}`,
  );

  summarizeView("model view", assembled.view);

  // Head / tail integrity
  const headUser = assembled.view[0];
  const headOk =
    headUser?.role === "user" &&
    headUser.content[0]?.type === "text" &&
    headUser.content[0].text.includes("relative paths under src/");
  const tailText = assembled.view.at(-1);
  const tailOk =
    tailText?.role === "assistant" &&
    tailText.content[0]?.type === "text" &&
    tailText.content[0].text.includes("src/");

  console.log(`\nhead verbatim constraint: ${headOk ? "PASS" : "FAIL"}`);
  console.log(`tail verbatim recent plan: ${tailOk ? "PASS" : "FAIL"}`);

  // Middle markers
  const hiddenInView: string[] = [];
  for (const m of assembled.view) {
    for (const p of m.content) {
      if (p.type === "tool_result") hiddenInView.push(...parseHiddenIds(p.content));
    }
  }
  console.log(`hidden markers in view: ${hiddenInView.join(", ") || "(none)"}`);
  console.log(`stash size: ${stash.size}`);

  const needleStillInView = assembled.view.some((m) =>
    m.content.some(
      (p) =>
        (p.type === "tool_result" && p.content.includes(MARKER)) ||
        (p.type === "text" && p.text.includes(MARKER)),
    ),
  );
  const needleInStash = [...stash.list()].some((e) =>
    e.content.includes(MARKER),
  );
  console.log(
    `NEEDLE in view: ${needleStillInView ? "FAIL (should be in omitted middle)" : "PASS (folded away)"}`,
  );
  console.log(`NEEDLE in stash: ${needleInStash ? "PASS" : "FAIL"}`);

  // Prefix stability: append a new tail turn and reassemble — head bytes must match
  const nextHistory = [
    ...history,
    userMessage("tail follow-up: implement it"),
    assistantMessage([textPart("On it.")]),
  ];
  const again = assembleContext({
    messages: nextHistory,
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
  const head1 = JSON.stringify(assembled.view.slice(0, 2));
  const head2 = JSON.stringify(again.view.slice(0, 2));
  console.log(
    `\nprefix (first 2 msgs) stable across grows: ${head1 === head2 ? "PASS" : "FAIL"}`,
  );

  // End-to-end: model calls recall_context for the needle id
  const needleId =
    stash.list().find((e) => e.content.includes(MARKER))?.id ?? hiddenInView[0];
  if (!needleId) {
    console.error("\nFAIL: no stash id for needle");
    process.exit(1);
  }

  console.log(`\n--- session + recall_context (${needleId}) ---`);
  const provider = mockProvider([
    {
      toolCalls: [
        { id: "r1", name: "recall_context", arguments: { id: needleId } },
      ],
    },
    { text: `recovered:${MARKER}` },
  ]);

  const agent = await createAgent({
    provider,
    extensions: [recallContextExtension(stash)],
  });

  const session = await createSession({
    agent,
    stash,
    initialMessages: history,
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

  const result = await session.run("The middle bash output had a secret marker — recall it.");
  const recalled = result.messages.some(
    (m) =>
      m.role === "tool" &&
      m.content.some(
        (p) => p.type === "tool_result" && p.content.includes(MARKER),
      ),
  );

  console.log(`assistant: ${result.text}`);
  console.log(`recall returned NEEDLE: ${recalled ? "PASS" : "FAIL"}`);
  console.log(
    `lastAssemble H/M/T=${session.lastAssemble?.regions?.headTurns}/${session.lastAssemble?.regions?.middleTurns}/${session.lastAssemble?.regions?.tailTurns} folded=${session.lastAssemble?.foldedParts}`,
  );

  // Provider saw a compact view (not full 18k blobs)
  const firstCall = provider.calls[0];
  const sentToolChars =
    firstCall?.messages
      .flatMap((m) => m.content)
      .filter((p) => p.type === "tool_result")
      .reduce((n, p) => n + (p.type === "tool_result" ? p.content.length : 0), 0) ??
    0;
  console.log(
    `\nprovider first request tool_result chars=${sentToolChars} (canonical middle alone was ~72k)`,
  );

  await agent.dispose();

  const failed =
    !headOk ||
    !tailOk ||
    needleStillInView ||
    !needleInStash ||
    head1 !== head2 ||
    !recalled;

  console.log(`\n=== ${failed ? "FAILED" : "ALL CHECKS PASSED"} ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
