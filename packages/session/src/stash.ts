import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
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
  /**
   * Workspace-relative path of the spilled original, when spill is on.
   * The model can search this file with `rg`. Values stay in the file.
   */
  file?: string;
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

export interface CreateContextStashOptions {
  /**
   * Directory for folded originals. The fold marker records a path relative
   * to `spillRoot` so the model can `rg` that file.
   */
  spillDir?: string;
  /** Workspace root used to build the marker's relative `file=` path. */
  spillRoot?: string;
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

export function createContextStash(
  opts: CreateContextStashOptions = {},
): ContextStash {
  const entries = new Map<string, ContextStashEntry>();
  const spillDir = opts.spillDir;
  const spillRoot = opts.spillRoot ?? spillDir;

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
        file: spill(spillDir, spillRoot, id, input.content),
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
      if (spillDir) rmSync(spillDir, { recursive: true, force: true });
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
function spill(
  spillDir: string | undefined,
  spillRoot: string | undefined,
  id: string,
  content: string,
): string | undefined {
  if (!spillDir || !spillRoot) return undefined;
  const name = `${id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "output"}.txt`;
  const abs = path.join(spillDir, name);
  mkdirSync(spillDir, { recursive: true });
  writeFileSync(abs, content, "utf8");
  return path.relative(spillRoot, abs).split(path.sep).join("/");
}

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
