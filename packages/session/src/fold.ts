import type { ContentPart, Message, ToolResultPart } from "@min/core";

export interface ContextFoldOptions {
  /**
   * Max characters per `tool_result` content in the **model view**.
   * `0` or `false` disables folding. Default: `8000`.
   */
  maxToolResultChars?: number | false;
  /** Characters kept from the start when folding. Default: `2400`. */
  toolResultHeadChars?: number;
  /** Characters kept from the end when folding. Default: `2400`. */
  toolResultTailChars?: number;
  /** Marker inserted between head and tail. */
  toolResultOmissionMarker?: string;
}

export const DEFAULT_FOLD_OPTIONS: Required<
  Omit<ContextFoldOptions, "maxToolResultChars">
> & { maxToolResultChars: number } = {
  maxToolResultChars: 8000,
  toolResultHeadChars: 2400,
  toolResultTailChars: 2400,
  toolResultOmissionMarker: "\n\n…[tool output truncated for context]…\n\n",
};

export function resolveFoldOptions(
  fold: ContextFoldOptions | false | undefined,
): ContextFoldOptions & { maxToolResultChars: number } | null {
  if (fold === false) return null;
  const max = fold?.maxToolResultChars;
  if (max === false || max === 0) return null;
  return {
    ...DEFAULT_FOLD_OPTIONS,
    ...fold,
    maxToolResultChars:
      typeof max === "number" && max > 0
        ? max
        : DEFAULT_FOLD_OPTIONS.maxToolResultChars,
  };
}

/** Head+tail fold of a single string when over maxChars. */
export function foldText(
  text: string,
  maxChars: number,
  headChars: number,
  tailChars: number,
  marker: string,
): { text: string; folded: boolean } {
  if (text.length <= maxChars) return { text, folded: false };
  const head = Math.max(0, headChars);
  const tail = Math.max(0, tailChars);
  if (head + tail + marker.length >= text.length) {
    // Degenerate knobs — hard slice.
    return { text: text.slice(0, maxChars) + marker.trimEnd(), folded: true };
  }
  return {
    text: text.slice(0, head) + marker + text.slice(text.length - tail),
    folded: true,
  };
}

/**
 * Deep-clone messages and fold oversized tool_result parts.
 * Does not mutate the input (canonical history stays intact).
 */
export function foldMessagesForView(
  messages: Message[],
  fold: ContextFoldOptions | false | undefined,
): { messages: Message[]; foldedParts: number } {
  const opts = resolveFoldOptions(fold);
  if (!opts) {
    return { messages: messages.map(cloneMessage), foldedParts: 0 };
  }

  let foldedParts = 0;
  const out = messages.map((msg) => {
    const content = msg.content.map((part) => {
      if (part.type !== "tool_result") return clonePart(part);
      const next = foldToolResultPart(part, opts);
      if (next.folded) foldedParts += 1;
      return next.part;
    });
    return { role: msg.role, content } as Message;
  });
  return { messages: out, foldedParts };
}

/**
 * Shrink the largest tool_result parts until estimated tokens fit, or no
 * further shrink is possible. Mutates the cloned `messages` in place.
 */
export function shrinkToolResultsToFit(
  messages: Message[],
  maxTokens: number,
  estimateMessages: (msgs: Message[]) => number,
  fold: ContextFoldOptions | false | undefined = {},
): { foldedParts: number } {
  const opts = resolveFoldOptions(fold) ?? {
    ...DEFAULT_FOLD_OPTIONS,
    maxToolResultChars: 8000,
  };
  let foldedParts = 0;
  let guard = 0;

  while (estimateMessages(messages) > maxTokens && guard++ < 32) {
    const target = findLargestToolResult(messages);
    if (!target) break;

    const { messageIndex, partIndex, content } = target;
    const part = messages[messageIndex]!.content[partIndex] as ToolResultPart;
    // Halve toward a small floor so a single giant result can fit.
    const nextMax = Math.max(256, Math.floor(content.length / 2));
    if (nextMax >= content.length) break;

    const folded = foldText(
      content,
      nextMax,
      Math.min(opts.toolResultHeadChars ?? 2400, Math.floor(nextMax * 0.45)),
      Math.min(opts.toolResultTailChars ?? 2400, Math.floor(nextMax * 0.45)),
      opts.toolResultOmissionMarker ?? DEFAULT_FOLD_OPTIONS.toolResultOmissionMarker,
    );
    messages[messageIndex]!.content[partIndex] = {
      ...part,
      content: folded.text,
    };
    if (folded.folded) foldedParts += 1;
  }

  return { foldedParts };
}

function findLargestToolResult(
  messages: Message[],
): { messageIndex: number; partIndex: number; content: string } | null {
  let best: {
    messageIndex: number;
    partIndex: number;
    content: string;
  } | null = null;
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi]!;
    for (let pi = 0; pi < msg.content.length; pi++) {
      const part = msg.content[pi]!;
      if (part.type !== "tool_result") continue;
      if (!best || part.content.length > best.content.length) {
        best = { messageIndex: mi, partIndex: pi, content: part.content };
      }
    }
  }
  return best;
}

function foldToolResultPart(
  part: ToolResultPart,
  opts: NonNullable<ReturnType<typeof resolveFoldOptions>>,
): { part: ToolResultPart; folded: boolean } {
  const folded = foldText(
    part.content,
    opts.maxToolResultChars,
    opts.toolResultHeadChars ?? DEFAULT_FOLD_OPTIONS.toolResultHeadChars,
    opts.toolResultTailChars ?? DEFAULT_FOLD_OPTIONS.toolResultTailChars,
    opts.toolResultOmissionMarker ??
      DEFAULT_FOLD_OPTIONS.toolResultOmissionMarker,
  );
  if (!folded.folded) return { part: { ...part }, folded: false };
  return {
    part: { ...part, content: folded.text },
    folded: true,
  };
}

function cloneMessage(message: Message): Message {
  return {
    role: message.role,
    content: message.content.map(clonePart),
  };
}

function clonePart(part: ContentPart): ContentPart {
  if (part.type === "tool_call") {
    return {
      type: "tool_call",
      id: part.id,
      name: part.name,
      arguments: { ...part.arguments },
    };
  }
  if (part.type === "tool_result") {
    return {
      type: "tool_result",
      toolCallId: part.toolCallId,
      content: part.content,
      isError: part.isError,
    };
  }
  return { type: "text", text: part.text };
}
