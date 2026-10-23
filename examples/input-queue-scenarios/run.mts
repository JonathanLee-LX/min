/**
 * Realistic input-queue scenarios (session-layer only; @min/core untouched).
 *
 * A) Task in progress + successive information supplements (enqueue)
 * B) Task direction set, then rapidly revised (dense-latest keeps newest)
 */
import {
  createAgent,
  deepseekProvider,
  type ModelProvider,
} from "@min/core";
import {
  createInputQueue,
  createSession,
  defineSessionExtension,
} from "@min/session";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFiles(): void {
  for (const file of [
    resolve(process.cwd(), ".env"),
    resolve(process.env.HOME ?? "", ".config/min/.env"),
  ]) {
    try {
      const raw = readFileSync(file, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i <= 0) continue;
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (process.env[k] === undefined) process.env[k] = v;
      }
    } catch {
      /* missing ok */
    }
  }
}

loadEnvFiles();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveDemoProvider(): ModelProvider {
  if (process.env.DEEPSEEK_API_KEY) {
    return deepseekProvider({
      api: process.env.DEEPSEEK_API === "chat" ? "chat" : "responses",
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-flash",
    });
  }
  console.warn("(no DEEPSEEK_API_KEY — using slow mock provider)");
  return {
    id: "mock-slow",
    async complete(req) {
      await sleep(2200);
      const n = req.messages.filter((m) => m.role === "user").length;
      return {
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `[mock] 已处理到第 ${n} 条用户消息（含历史）。`,
            },
          ],
        },
        stopReason: "end",
      };
    },
  };
}

function banner(title: string) {
  console.log(`\n======== ${title} ========`);
}

function printUserTurns(
  messages: { role: string; content: { type: string; text?: string }[] }[],
) {
  console.log("\n--- canonical user turns ---");
  for (const m of messages.filter((x) => x.role === "user")) {
    const t = m.content
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("");
    console.log(`· ${t}`);
  }
}

async function makeSession(label: string) {
  const agent = await createAgent({
    provider: resolveDemoProvider(),
    system: [
      "You are min, a concise coding agent.",
      "If the user revises the task, follow the latest revision.",
      "Keep each answer under ~120 Chinese characters unless they ask for more.",
    ].join(" "),
    maxTurns: 3,
  });

  const queue = createInputQueue({
    mode: "enqueue",
    denseWindowMs: 1500,
    denseMode: "dense-latest",
  });

  const session = await createSession({
    agent,
    inputQueue: queue,
    id: `ses_queue_${label}_${Date.now().toString(36)}`,
    extensions: [
      defineSessionExtension({
        name: "scenario-log",
        hooks: {
          onBeforeRun({ input }) {
            console.log(`\n▶ agent pass ← ${input}`);
          },
          onIncoming(texts) {
            console.log(`⊕ session drain ×${texts.length}:`);
            for (const t of texts) console.log(`   · ${t}`);
          },
          onAfterRun({ result }) {
            console.log(`\n◀ assistant: ${result.text ?? "(empty)"}`);
          },
        },
      }),
    ],
  });

  return { agent, session, queue };
}

/** A: mid-task information supplements (spaced → separate enqueue items). */
async function scenarioSupplement() {
  banner("场景 A：任务进行中补充信息（enqueue，间隔 > 1.5s）");
  console.log(`设定:
  1. 用户先下任务：说明 Session 内核与扩展点
  2. 执行中补充：强调 Store 可替换
  3. 稍后再补充：不要展开 Assembler
  期望: 首次 agent 结束后 drain 两次补充（合并为一次 follow-up 用户消息）`);

  const { agent, session, queue } = await makeSession("supplement");

  const running = session.run(
    "请用两三句话说明 @min/session 里 Session 内核负责什么、扩展点有哪些。",
    {
      onEvent(e) {
        if (e.type === "text_delta") process.stdout.write(e.text);
      },
    },
  );

  await sleep(500);
  queue.push("补充：请特别提一下 SessionStore 可以换成外部存储（例如 R2）。");
  console.log(`\n(user interject #1, queue=${queue.size})`);

  await sleep(1700);
  queue.push("再补充：回答里不要展开 ContextAssembler 的实现细节。");
  console.log(`(user interject #2, queue=${queue.size})`);

  await running;
  printUserTurns(session.messages as never);
  await session.dispose();
  await agent.dispose();
}

/** B: set direction, then rapidly change direction (dense-latest). */
async function scenarioRedirect() {
  banner("场景 B：先定方向，再密集改方向（dense-latest）");
  console.log(`设定:
  1. 用户先要求：把 README 译成日文
  2. 很快改口：只译 Why min
  3. 再改方向：不要翻译，改成三条中文 bullet 概括
  期望: dense-latest 只保留最后一条方向；follow-up 只有一次`);

  const { agent, session, queue } = await makeSession("redirect");

  const running = session.run(
    "请把仓库根目录 README.md 翻译成日文，输出完整译文。",
    {
      onEvent(e) {
        if (e.type === "text_delta") process.stdout.write(e.text);
      },
    },
  );

  await sleep(400);
  queue.push("补充：其实只要翻译 Why min 那一节就行。", {
    mode: "dense-latest",
  });
  console.log(`\n(redirect #1, queue=${queue.size}) peek=${JSON.stringify(queue.peek())}`);

  await sleep(250);
  queue.push(
    "改方向：不要翻译了。改为用中文三条 bullet 概括整个 README 在讲什么。",
    { mode: "dense-latest" },
  );
  console.log(
    `(redirect #2, queue=${queue.size}) peek=${JSON.stringify(queue.peek())}`,
  );

  await running;
  printUserTurns(session.messages as never);
  await session.dispose();
  await agent.dispose();
}

banner("input-queue scenarios");
await scenarioSupplement();
await scenarioRedirect();
banner("done");
