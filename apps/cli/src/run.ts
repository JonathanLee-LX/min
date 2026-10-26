import {
  createAutoPermissionApprover,
  createClient,
  type MinClient,
  type PermissionAnswer,
} from "@min/client";
import {
  loadProviderExtensions,
  resolveProvider,
  sessionDirFor as appSessionDir,
} from "@min/runtime";
import type { Interface as ReadlineInterface } from "node:readline/promises";
import type { CliArgs } from "./args.js";
import { createEventPrinter } from "./events.js";
import { isAbortError, withSigintAbort } from "./interrupt.js";
import { contextBudgetLog } from "./session-extensions.js";

export type CliClient = {
  client: MinClient;
  args: CliArgs;
};

export function sessionDirFor(args: CliArgs): string {
  return appSessionDir(args.cwd, args.sessionDir);
}

export async function createCliClient(args: CliArgs): Promise<CliClient> {
  await loadProviderExtensions();
  const autoMode = args.auto ? "auto" : args.yes ? "yes" : undefined;
  const client = await createClient({
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
    allowBash: args.allowBash || args.yes || args.auto,
    maxContextTokens: args.maxContextTokens,
    maxUserTurns: args.maxUserTurns,
    contextStrategy: args.contextStrategy,
    sessionExtensions: [contextBudgetLog()],
    // Interactive CLI applies grantRoot itself; auto/yes+root-grant use Client.
    applyRootGrant: args.auto || args.allowRootGrant,
    autoApprovePermission: autoMode
      ? createAutoPermissionApprover({
          mode: autoMode,
          allowRootGrant: args.allowRootGrant,
        })
      : undefined,
  });
  return { client, args };
}

/** List sessions through @min/client (same store Runtime would use). */
export async function listSessions(args: CliArgs): Promise<void> {
  const cli = await createCliClient({ ...args, noTools: true });
  try {
    const metas = await cli.client.listSessions();
    const dir = sessionDirFor(args);
    if (!metas.length) {
      console.log(`(no sessions in ${dir})`);
      return;
    }
    for (const m of metas) {
      const title = m.title ? `  ${m.title}` : "";
      console.log(`${m.id}  ${m.updatedAt}${title}`);
    }
  } finally {
    await cli.client.dispose();
  }
}

export async function runTurn(
  cli: CliClient,
  prompt: string,
  rl?: ReadlineInterface,
): Promise<void> {
  const { client, args } = cli;
  const printer = createEventPrinter();
  const pauseRl = Boolean(rl && process.stdin.isTTY);
  if (pauseRl) rl!.pause();

  let stopQueueListen: (() => void) | undefined;
  if (pauseRl) {
    stopQueueListen = listenStdinQueue(client);
  }

  const unsub = client.subscribe((event) => {
    if (event.type === "assistant_delta") {
      printer.onEvent({ type: "text_delta", text: event.text });
      return;
    }
    if (event.type === "tool_start") {
      printer.onEvent({
        type: "tool_call",
        toolCall: {
          type: "tool_call",
          id: event.toolCallId,
          name: event.name,
          arguments: event.args,
        },
      });
      return;
    }
    if (event.type === "tool_end") {
      printer.onEvent({
        type: "tool_result",
        toolCallId: event.toolCallId,
        content: event.preview,
        isError: !event.ok,
      });
      return;
    }
    if (event.type === "follow_up") {
      const preview = event.texts.join(" | ");
      const clipped =
        preview.length > 120 ? `${preview.slice(0, 117)}...` : preview;
      console.error(`⊕ follow-up ×${event.texts.length}: ${clipped}`);
      return;
    }
    if (event.type === "queued") {
      console.error(`(queued → ${event.queueSize})`);
      return;
    }
    if (event.type === "error" && !event.aborted) {
      console.error(`error: ${event.message}`);
      return;
    }
    if (event.type === "permission") {
      void (async () => {
        try {
          const answer = await resolvePermissionInteractive(
            args,
            rl,
            event,
            pauseRl,
            stopQueueListen,
          );
          // applyRootGrant is false on CLI so we control grantRoot here.
          if (answer !== "deny" && event.grantRoot) {
            client.advanced.runtime.permissions?.grantRoot(event.grantRoot);
          }
          client.respondPermission(event.id, answer);
        } catch {
          client.respondPermission(event.id, "deny");
        }
      })();
    }
  });

  try {
    await withSigintAbort(async (signal) => {
      await client.send(prompt, { signal });
      printer.endTextLine();
      if (!printer.didStreamText()) {
        // assistant_done already streamed via deltas usually; nothing else
      }
    });
  } catch (err) {
    printer.endTextLine();
    if (isAbortError(err)) return;
    throw err;
  } finally {
    unsub();
    stopQueueListen?.();
    if (pauseRl) rl!.resume();
  }
}

async function resolvePermissionInteractive(
  args: CliArgs,
  rl: ReadlineInterface | undefined,
  event: {
    reason: string;
    grantRoot?: string;
    toolCall: { name: string };
  },
  pauseRl: boolean,
  stopQueueListen?: () => void,
): Promise<PermissionAnswer> {
  if (args.auto) return "allow_session";
  if (args.yes) {
    if (event.grantRoot && !args.allowRootGrant) return "deny";
    return "allow";
  }
  if (!rl || !process.stdin.isTTY) return "deny";

  stopQueueListen?.();
  rl.resume();
  try {
    if (event.grantRoot) {
      return promptRootGrant(rl, event.reason, event.grantRoot);
    }
    return promptPermission(rl, event.reason);
  } finally {
    if (pauseRl) rl.pause();
  }
}

function listenStdinQueue(client: MinClient): (() => void) | undefined {
  if (!process.stdin.isTTY) return undefined;
  let buf = "";
  const onData = (chunk: string | Buffer) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "").trim();
      buf = buf.slice(nl + 1);
      if (!line || line.startsWith("/")) continue;
      try {
        client.queue.push(line);
      } catch {
        // queue disabled
      }
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
): Promise<PermissionAnswer> {
  console.log(`\n⚠ permission: ${reason}`);
  const line = (
    await rl.question(
      "Allow? [y]es / [n]o / [a]lways this tool (rest of session) > ",
    )
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
): Promise<PermissionAnswer> {
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
