import {
  assistantMessage,
  textPart,
  type Message,
  type ModelProvider,
} from "@min/core";
import type { AssembleInput, AssembleResult } from "./assemble.js";
import { assembleTrimContext } from "./assemble-trim.js";
import { messageTextApprox } from "./compact-prompt.js";

export interface CompactAssembleOptions {
  /** Provider used only for summarization (no tools). */
  provider: ModelProvider;
  /**
   * Run compact when dropped messages estimate exceeds this many tokens.
   * Default: 800.
   */
  minDroppedTokens?: number;
  /** Max characters of dropped history fed into the summarizer. Default: 24_000. */
  maxSourceChars?: number;
  signal?: AbortSignal;
}

/**
 * Trim first; if enough history was dropped, ask `provider` for a structured
 * summary and prepend it to the model view. Failures fall back to trim.
 *
 * Explicit / threshold-gated — not intended to run heavy LLM work every turn
 * unless dropped volume warrants it.
 */
export async function assembleCompactContext(
  input: AssembleInput,
  opts: CompactAssembleOptions,
): Promise<AssembleResult> {
  const trimmed = assembleTrimContext(input);
  const minDropped = opts.minDroppedTokens ?? 800;
  const estimate = input.budget.estimate;
  const droppedTokens = estimate
    ? estimate.messages(trimmed.dropped)
    : Math.ceil(JSON.stringify(trimmed.dropped).length / 4);

  if (!trimmed.dropped.length || droppedTokens < minDropped) {
    return { ...trimmed, strategy: "compact" };
  }

  try {
    const summary = await summarizeDropped(trimmed.dropped, opts);
    const summaryMsg = assistantMessage([
      textPart(
        `[context compact] Prior turns were summarized for budget:\n${summary}`,
      ),
    ]);
    const view = [summaryMsg, ...trimmed.view];
    return {
      ...trimmed,
      view,
      // Keep store merge on the trimmed suffix (summary is view-only).
      kept: trimmed.kept,
      trimmed: true,
      strategy: "compact",
    };
  } catch {
    return { ...trimmed, strategy: "compact" };
  }
}

async function summarizeDropped(
  dropped: Message[],
  opts: CompactAssembleOptions,
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
