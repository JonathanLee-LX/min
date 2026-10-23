import {
  createRuntime,
  resolveProvider,
  sessionDirFor as appSessionDir,
  type Runtime,
  type PermissionAskResult,
} from "@min/runtime";
import { createFsStore } from "@min/session";
import type { Interface as ReadlineInterface } from "node:readline/promises";
import type { CliArgs } from "./args.js";
import { createEventPrinter } from "./events.js";
import { isAbortError, withSigintAbort } from "./interrupt.js";
import { contextBudgetLog } from "./session-extensions.js";

export type CliRuntime = Runtime & { args: CliArgs };

export function sessionDirFor(args: CliArgs): string {
  return appSessionDir(args.cwd, args.sessionDir);
}

export async function createCliRuntime(args: CliArgs): Promise<CliRuntime> {
  const runtime = await createRuntime({
    cwd: args.cwd,
    provider: resolveProvider({
      provider: args.provider,
      model: args.model,
    }),
    sessionId: args.sessionId,
    sessionDir: args.sessionDir,
    noSessionStore: args.noSessionStore,
    noTools: args.noTools,
    skillsDir: args.skillsDir,
    addRoots: args.addRoots,
    askWrite: args.askWrite,
    allowBash: args.allowBash || args.yes,
    maxContextTokens: args.maxContextTokens,
    maxUserTurns: args.maxUserTurns,
    sessionExtensions: [contextBudgetLog()],
  });
  return { ...runtime, args };
}

export async function listSessions(args: CliArgs): Promise<void> {
  const store = createFsStore(sessionDirFor(args));
  const metas = await store.list();
  if (!metas.length) {
    console.log(`(no sessions in ${sessionDirFor(args)})`);
    return;
  }
  for (const m of metas) {
    const title = m.title ? `  ${m.title}` : "";
    console.log(`${m.id}  ${m.updatedAt}${title}`);
  }
}

export async function runTurn(
  runtime: CliRuntime,
  prompt: string,
  rl?: ReadlineInterface,
): Promise<void> {
  const { session, permissions, args } = runtime;
  const printer = createEventPrinter();
  const pauseRl = Boolean(rl && process.stdin.isTTY);
  if (pauseRl) rl!.pause();

  const stopQueueListen = pauseRl
    ? listenStdinQueue(session.inputQueue)
    : undefined;

  try {
    await withSigintAbort(async (signal) => {
      const result = await session.run(prompt, {
        signal,
        onEvent: printer.onEvent,
        onPermissionAsk: async (req) => {
          if (signal.aborted) return "deny";

          if (req.grantRoot) {
            if (args.allowRootGrant && (args.yes || !process.stdin.isTTY)) {
              permissions?.grantRoot(req.grantRoot);
              return "allow";
            }
            if (args.yes && !args.allowRootGrant) {
              return "deny";
            }
            if (!rl || !process.stdin.isTTY) {
              return "deny";
            }
            stopQueueListen?.();
            rl.resume();
            try {
              const answer = await promptRootGrant(
                rl,
                req.reason,
                req.grantRoot,
              );
              if (answer === "deny") return "deny";
              permissions?.grantRoot(req.grantRoot);
              if (answer === "allow_session") {
                permissions?.grantSession(req.toolCall);
              }
              return answer;
            } finally {
              if (pauseRl) rl.pause();
            }
          }

          if (args.yes) return "allow";
          if (!rl || !process.stdin.isTTY) return "deny";
          stopQueueListen?.();
          rl.resume();
          try {
            const answer = await promptPermission(rl, req.reason);
            if (answer === "allow_session" && permissions) {
              permissions.grantSession(req.toolCall);
            }
            return answer;
          } finally {
            if (pauseRl) rl.pause();
          }
        },
      });

      printer.endTextLine();

      if (!printer.didStreamText() && result.text) {
        process.stdout.write(`\n${result.text}\n`);
      }
    });
  } catch (err) {
    printer.endTextLine();
    if (isAbortError(err)) {
      return;
    }
    throw err;
  } finally {
    stopQueueListen?.();
    if (pauseRl) rl!.resume();
  }
}

function listenStdinQueue(
  queue: Runtime["session"]["inputQueue"],
): (() => void) | undefined {
  if (!queue || !process.stdin.isTTY) return undefined;
  let buf = "";
  const onData = (chunk: string | Buffer) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "").trim();
      buf = buf.slice(nl + 1);
      if (!line || line.startsWith("/")) continue;
      queue.push(line);
      console.error(`(queued → ${queue.size})`);
    }
  };
  process.stdin.on("data", onData);
  return () => {
    process.stdin.off("data", onData);
  };
}

async function promptPermission(
  rl: ReadlineInterface,
  reason: string,
): Promise<PermissionAskResult> {
  console.log(`\n⚠ permission: ${reason}`);
  const line = (
    await rl.question("Allow? [y]es / [n]o / [a]lways this tool > ")
  )
    .trim()
    .toLowerCase();

  if (line === "y" || line === "yes") return "allow";
  if (line === "a" || line === "always") return "allow_session";
  return "deny";
}

async function promptRootGrant(
  rl: ReadlineInterface,
  reason: string,
  grantRoot: string,
): Promise<PermissionAskResult> {
  console.log(`\n⚠ session root grant: ${reason}`);
  console.log(`   add root: ${grantRoot}`);
  const line = (
    await rl.question(
      "Grant session root? [y]es / [n]o / [a]lways (root + this tool) > ",
    )
  )
    .trim()
    .toLowerCase();

  if (line === "y" || line === "yes") return "allow";
  if (line === "a" || line === "always") return "allow_session";
  return "deny";
}
