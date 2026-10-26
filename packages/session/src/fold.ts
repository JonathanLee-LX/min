import type { ContentPart, Message, ToolResultPart } from "@min-agent/core";
import {
  hiddenMarker,
  type ContextStash,
} from "./stash.js";

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
  /**
   * Marker between head and tail when no stash is attached.
   * With a stash, markers always use {@link hiddenMarker}.
   */
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
    return { text: text.slice(0, maxChars) + marker.trimEnd(), folded: true };
  }
  return {
    text: text.slice(0, head) + marker + text.slice(text.length - tail),
    folded: true,
  };
}

export interface FoldViewOptions {
  fold?: ContextFoldOptions | false;
  /** When set, folded bodies are stashed and markers carry recall ids. */
  stash?: ContextStash;
  /**
   * Only fold messages with index in [start, end).
   * Default: entire array.
   */
  range?: { start: number; end: number };
  /** Resolve tool name for a tool_call id (for stash metadata). */
  toolNameByCallId?: ReadonlyMap<string, string>;
}

/**
 * Deep-clone messages and fold oversized tool_result parts in range.
 * Does not mutate the input (canonical history stays intact).
 */
export function foldMessagesForView(
  messages: Message[],
  foldOrOpts: ContextFoldOptions | false | undefined | FoldViewOptions,
): { messages: Message[]; foldedParts: number; stashedIds: string[] } {
  const opts: FoldViewOptions =
    foldOrOpts &&
    typeof foldOrOpts === "object" &&
    ("fold" in foldOrOpts ||
      "stash" in foldOrOpts ||
      "range" in foldOrOpts ||
      "toolNameByCallId" in foldOrOpts)
      ? foldOrOpts
      : { fold: foldOrOpts as ContextFoldOptions | false | undefined };

  const foldOpts = resolveFoldOptions(opts.fold);
  const start = opts.range?.start ?? 0;
  const end = opts.range?.end ?? messages.length;
  const stashedIds: string[] = [];

  if (!foldOpts) {
    return {
      messages: messages.map(cloneMessage),
      foldedParts: 0,
      stashedIds,
    };
  }

  let foldedParts = 0;
  const out = messages.map((msg, mi) => {
    const inRange = mi >= start && mi < end;
    const content = msg.content.map((part) => {
      if (!inRange || part.type !== "tool_result") return clonePart(part);
      const next = foldToolResultPart(part, foldOpts, {
        stash: opts.stash,
        toolName: opts.toolNameByCallId?.get(part.toolCallId),
      });
      if (next.folded) {
        foldedParts += 1;
        if (next.stashId) stashedIds.push(next.stashId);
      }
      return next.part;
    });
    return { role: msg.role, content } as Message;
  });
  return { messages: out, foldedParts, stashedIds };
}

/**
 * @deprecated Prefer H-M-T middle fold. Kept for tests / escape hatches.
 * Shrink the largest tool_result parts until estimated tokens fit.
 */
export function shrinkToolResultsToFit(
  messages: Message[],
  maxTokens: number,
  estimateMessages: (msgs: Message[]) => number,
  fold: ContextFoldOptions | false | undefined = {},
  stash?: ContextStash,
): { foldedParts: number; stashedIds: string[] } {
  const opts = resolveFoldOptions(fold) ?? {
    ...DEFAULT_FOLD_OPTIONS,
    maxToolResultChars: 8000,
  };
  let foldedParts = 0;
  const stashedIds: string[] = [];
  let guard = 0;

  while (estimateMessages(messages) > maxTokens && guard++ < 32) {
    const target = findLargestToolResult(messages);
    if (!target) break;

    const { messageIndex, partIndex, content } = target;
    const part = messages[messageIndex]!.content[partIndex] as ToolResultPart;
    const nextMax = Math.max(256, Math.floor(content.length / 2));
    if (nextMax >= content.length) break;

    let marker = opts.toolResultOmissionMarker ?? DEFAULT_FOLD_OPTIONS.toolResultOmissionMarker;
    let stashId: string | undefined;
    if (stash) {
      const entry = stash.put({
        kind: "tool_result",
        content,
        toolCallId: part.toolCallId,
        id: `tool_${part.toolCallId}`,
      });
      stashId = entry.id;
      stashedIds.push(entry.id);
      marker = hiddenMarker(entry.id);
    }

    const folded = foldText(
      content,
      nextMax,
      Math.min(opts.toolResultHeadChars ?? 2400, Math.floor(nextMax * 0.45)),
      Math.min(opts.toolResultTailChars ?? 2400, Math.floor(nextMax * 0.45)),
      marker,
    );
    messages[messageIndex]!.content[partIndex] = {
      ...part,
      content: folded.text,
    };
    if (folded.folded) foldedParts += 1;
    void stashId;
  }

  return { foldedParts, stashedIds };
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
  extra: { stash?: ContextStash; toolName?: string },
): { part: ToolResultPart; folded: boolean; stashId?: string } {
  if (part.content.length <= opts.maxToolResultChars) {
    return { part: { ...part }, folded: false };
  }

  let marker =
    opts.toolResultOmissionMarker ?? DEFAULT_FOLD_OPTIONS.toolResultOmissionMarker;
  let stashId: string | undefined;
  if (extra.stash) {
    const entry = extra.stash.put({
      kind: "tool_result",
      content: part.content,
      toolCallId: part.toolCallId,
      toolName: extra.toolName,
      id: `tool_${part.toolCallId}`,
    });
    stashId = entry.id;
    marker = hiddenMarker(entry.id);
  }

  const folded = foldText(
    part.content,
    opts.maxToolResultChars,
    opts.toolResultHeadChars ?? DEFAULT_FOLD_OPTIONS.toolResultHeadChars,
    opts.toolResultTailChars ?? DEFAULT_FOLD_OPTIONS.toolResultTailChars,
    marker,
  );
  if (!folded.folded) return { part: { ...part }, folded: false };
  return {
    part: { ...part, content: folded.text },
    folded: true,
    stashId,
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

/** Build toolCallId → tool name map from a message list. */
export function indexToolNames(
  messages: Message[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const msg of messages) {
    for (const part of msg.content) {
      if (part.type === "tool_call") map.set(part.id, part.name);
    }
  }
  return map;
}
