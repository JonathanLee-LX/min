import {
  createAutoPermissionApprover,
  createClient,
  readTurnFiles,
  type MinClient,
  type PermissionAnswer,
  type TurnAttachment,
} from "@min-agent/client";
import { applyAuthToEnv, resolveMinConfig } from "@min-agent/config";
import {
  loadProviderExtensions,
  resolveProvider,
  sessionDirFor as appSessionDir,
} from "@min-agent/runtime";
import type { Interface as ReadlineInterface } from "node:readline/promises";
import { parseStrategy, type CliArgs } from "./args.js";
import { createEventPrinter } from "./events.js";
import { isAbortError, withSigintAbort } from "./interrupt.js";
import { contextBudgetLog } from "./session-extensions.js";
import { formatCliSessionLines } from "./session-line.js";

export type CliClient = {
  client: MinClient;
  args: CliArgs;
  pendingAttachments: TurnAttachment[];
};

export function sessionDirFor(args: CliArgs): string {
  return appSessionDir(args.cwd, args.sessionDir);
}

export async function createCliClient(args: CliArgs): Promise<CliClient> {
  const { config } = resolveMinConfig({ cwd: args.cwd }, args.flags);
  applyAuthToEnv(config.auth);
  const resolved: CliArgs = {
    ...args,
    provider: config.provider ?? args.provider,
    model: config.model ?? args.model,
    sessionDir: config.runtime.sessionDir ?? args.sessionDir,
    maxTurns: config.runtime.maxTurns ?? args.maxTurns,
    maxContextTokens: config.runtime.maxContextTokens ?? args.maxContextTokens,
    contextStrategy: parseStrategy(config.runtime.contextStrategy) ?? args.contextStrategy,
    allowBash: args.allowBash || config.settings.permissions?.bash === "allow",
    askWrite: args.askWrite || config.settings.permissions?.write === "ask",
  };
  await loadProviderExtensions();
  const autoMode = resolved.auto ? "auto" : resolved.yes ? "yes" : undefined;
  const client = await createClient({
    cwd: resolved.cwd,
    provider: resolveProvider({
      provider: resolved.provider,
      model: resolved.model,
      reasoningEffort: config.reasoningEffort,
    }),
    sessionId: resolved.sessionId,
    sessionDir: resolved.sessionDir,
    noSessionStore: resolved.noSessionStore,
    noTools: resolved.noTools,
    skillsDir: resolved.skillsDir,
    addRoots: resolved.addRoots,
    askWrite: resolved.askWrite,
    allowBash: resolved.allowBash || resolved.yes || resolved.auto,
    maxContextTokens: resolved.maxContextTokens,
    maxUserTurns: resolved.maxUserTurns,
    maxTurns: resolved.maxTurns,
    contextStrategy: resolved.contextStrategy,
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
  for (const notice of client.notices.list()) console.error(notice.message);
  client.notices.subscribe((notice) => console.error(notice.message));
  return { client, args: resolved, pendingAttachments: [] };
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
    for (const line of formatCliSessionLines(metas)) console.log(line);
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
      const fromFlags = args.files.length ? await readTurnFiles(args.files) : [];
      const attachments = [...cli.pendingAttachments, ...fromFlags];
      cli.pendingAttachments = [];
      args.files = [];
      await client.send(prompt, {
        signal,
        ...(attachments.length ? { attachments } : {}),
      });
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
