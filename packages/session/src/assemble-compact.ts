import {
  assistantMessage,
  textPart,
  type Message,
  type ModelProvider,
} from "@min-agent/core";
import { splitUserTurns } from "./assemble.js";
import { messageTextApprox } from "./compact-prompt.js";

export interface CompactHistoryOptions {
  /** Provider used only for summarization (no tools). */
  provider: ModelProvider;
  /** Keep this many trailing user-turns verbatim. Default: 2. */
  keepRecentTurns?: number;
  /** Max characters of dropped history fed into the summarizer. Default: 24_000. */
  maxSourceChars?: number;
  signal?: AbortSignal;
}

export interface CompactHistoryResult {
  /** Rewritten canonical history: summary message + recent turns. */
  messages: Message[];
  summary: string;
  droppedMessageCount: number;
  keptTurns: number;
}

/**
 * Explicit history compact: summarize older turns and rewrite the store to
 * `[summary] + recent turns`. Not a continuous assemble strategy — call on
 * demand (e.g. CLI `/compact`).
 */
export async function compactHistoryMessages(
  messages: Message[],
  opts: CompactHistoryOptions,
): Promise<CompactHistoryResult> {
  const keepRecent = Math.max(1, opts.keepRecentTurns ?? 2);
  const turns = splitUserTurns(messages);
  if (turns.length <= keepRecent) {
    return {
      messages: [...messages],
      summary: "",
      droppedMessageCount: 0,
      keptTurns: turns.length,
    };
  }

  const droppedTurns = turns.slice(0, turns.length - keepRecent);
  const keptTurns = turns.slice(turns.length - keepRecent);
  const dropped = droppedTurns.flat();
  const kept = keptTurns.flat();

  const summary = await summarizeDropped(dropped, opts);
  const summaryMsg = assistantMessage([
    textPart(
      `[context compact] Earlier turns were summarized on demand:\n${summary}`,
    ),
  ]);

  return {
    messages: [summaryMsg, ...kept],
    summary,
    droppedMessageCount: dropped.length,
    keptTurns: keptTurns.length,
  };
}

async function summarizeDropped(
  dropped: Message[],
  opts: CompactHistoryOptions,
): Promise<string> {
  const maxChars = opts.maxSourceChars ?? 24_000;
  let source = messageTextApprox(dropped);
  if (source.length > maxChars) {
    source =
      source.slice(0, Math.floor(maxChars * 0.55)) +
      "\n…\n" +
      source.slice(source.length - Math.floor(maxChars * 0.35));
  }

  const result = await opts.provider.complete({
    system: [
      "Compress the conversation excerpt into a compact structured brief.",
      "Use these headings exactly: Objective, Decisions, Constraints, Facts, Open threads, Rejected.",
      "Preserve exact ids, paths, and user constraints. Do not invent details.",
      "Keep the whole brief under 400 words.",
    ].join(" "),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Conversation excerpt to compress:\n\n${source}`,
          },
        ],
      },
    ],
    maxTokens: 800,
    signal: opts.signal,
  });

  const text = result.message.content
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
  return text || "(empty summary)";
}
