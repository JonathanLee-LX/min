import { buildOutline, type ContextOutlineItem } from "./outline.js";

export type ContextStashKind = "tool_result" | "turn";

export interface ContextStashEntry {
  id: string;
  kind: ContextStashKind;
  /** Original full text. */
  content: string;
  charCount: number;
  /** Short preview for list/recall UX. */
  preview: string;
  /** Indexed facts (names and offsets, never values). */
  outline: ContextOutlineItem[];
  toolCallId?: string;
  toolName?: string;
  /** ISO timestamp of last put/update. */
  updatedAt: string;
}

export interface ContextStashPutInput {
  kind: ContextStashKind;
  content: string;
  /** Stable id; defaults to tool_* / auto id. */
  id?: string;
  toolCallId?: string;
  toolName?: string;
  previewChars?: number;
}

export interface ContextStash {
  put(input: ContextStashPutInput): ContextStashEntry;
  get(id: string): ContextStashEntry | undefined;
  list(): ContextStashEntry[];
  has(id: string): boolean;
  clear(): void;
  readonly size: number;
}

let seq = 0;

export function createContextStash(): ContextStash {
  const entries = new Map<string, ContextStashEntry>();

  return {
    put(input) {
      const id =
        input.id ??
        (input.toolCallId
          ? `tool_${input.toolCallId}`
          : `ctx_${(++seq).toString(36)}`);
      const previewChars = input.previewChars ?? 160;
      const preview =
        input.content.length <= previewChars
          ? input.content
          : `${input.content.slice(0, previewChars)}…`;
      const entry: ContextStashEntry = {
        id,
        kind: input.kind,
        content: input.content,
        charCount: input.content.length,
        preview,
        outline: buildOutline(input.content),
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        updatedAt: new Date().toISOString(),
      };
      entries.set(id, entry);
      return entry;
    },

    get(id) {
      return entries.get(id);
    },

    list() {
      return [...entries.values()];
    },

    has(id) {
      return entries.has(id);
    },

    clear() {
      entries.clear();
    },

    get size() {
      return entries.size;
    },
  };
}

/**
 * Marker embedded in folded tool_result view text.
 * `digest` is an outline summary (`chars=… · key=NAME@offset`) and must not
 * contain the hidden values.
 */
export function hiddenMarker(id: string, digest?: string): string {
  const extra = digest ? ` · ${digest}` : "";
  return `\n\n…[hidden:${id} · recall_context${extra}]…\n\n`;
}

/** Parse stash ids referenced in a folded view string. */
export function parseHiddenIds(text: string): string[] {
  const ids: string[] = [];
  const re = /\[hidden:([^\s\]]+)\s*·\s*recall_context\b[^\]]*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = m[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
