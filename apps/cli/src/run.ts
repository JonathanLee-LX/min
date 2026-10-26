import {
  createAutoPermissionApprover,
  createClient,
  type MinClient,
  type PermissionAnswer,
} from "@min-agent/client";
import {
  loadProviderExtensions,
  resolveProvider,
  sessionDirFor as appSessionDir,
} from "@min-agent/runtime";
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
    maxTurns: args.maxTurns,
    contextStrategy: args.contextStrategy,
    sessionExtensions: [contextBudgetLog()],
    // Interactive CLI applies grantRoot itself; auto/yes+root-grant use Client.
    applyRootGrant: args.auto || args.allowRootGrant,
    persistPermissionGrants: !args.auto,
    autoApprovePermission: autoMode
      ? createAutoPermissionApprover({
          mode: autoMode,
          allowRootGrant: args.allowRootGrant,
        })
      : undefined,
  });
  return { client, args };
}

/** List sessions through @min-agent/client (same store Runtime would use). */
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
  // `line` is not emitted while `question()` is waiting, so a permission
  // answer is not also pushed onto the follow-up queue.
  const stopQueueListen = rl ? attachFollowUpQueue(rl, client) : undefined;

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
          const answer = await resolvePermissionInteractive(args, rl, event);
          // applyRootGrant is false on CLI so we control grantRoot here.
          if (answer !== "deny" && event.grantRoot) {
            client.advanced.runtime.permissions?.grantRoot(event.grantRoot, {
              persist: answer === "allow_session" && !args.auto,
            });
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
  }
}

/** Follow-up lines typed during a run. No-op while a permission question is open. */
export function attachFollowUpQueue(
  rl: ReadlineInterface,
  client: MinClient,
): () => void {
  const onLine = (line: string) => {
    const text = line.trim();
    if (!text || text.startsWith("/")) return;
    try {
      client.queue.push(text);
    } catch {
      // queue disabled
    }
  };
  rl.on("line", onLine);
  return () => {
    rl.off("line", onLine);
  };
}

export function permissionAnswerFromLine(line: string): PermissionAnswer {
  const answer = line.trim().toLowerCase();
  if (answer === "y" || answer === "yes") return "allow";
  if (answer === "a" || answer === "always") return "allow_session";
  return "deny";
}

async function resolvePermissionInteractive(
  args: CliArgs,
  rl: ReadlineInterface | undefined,
  event: {
    reason: string;
    grantRoot?: string;
    toolCall: { name: string };
  },
): Promise<PermissionAnswer> {
  if (args.auto) return "allow_session";
  if (args.yes) {
    if (event.grantRoot && !args.allowRootGrant) return "deny";
    return "allow";
  }
  if (!rl || !process.stdin.isTTY) return "deny";

  if (event.grantRoot) {
    return promptRootGrant(rl, event.reason, event.grantRoot);
  }
  return promptPermission(rl, event.reason);
}

async function promptPermission(
  rl: ReadlineInterface,
  reason: string,
): Promise<PermissionAnswer> {
  console.log(`\n⚠ permission: ${reason}`);
  const line = await rl.question(
    "Allow? [y]es / [n]o / [a]lways remember this pattern > ",
  );
  return permissionAnswerFromLine(line);
}

async function promptRootGrant(
  rl: ReadlineInterface,
  reason: string,
  grantRoot: string,
): Promise<PermissionAnswer> {
  console.log(`\n⚠ session root grant: ${reason}`);
  console.log(`   add root: ${grantRoot}`);
  const line = await rl.question(
    "Grant session root? [y]es / [n]o / [a]lways remember this root > ",
  );
  return permissionAnswerFromLine(line);
}
