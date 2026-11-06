import { defineTool, type Tool } from "@min-agent/core";
import { z } from "zod";
import { formatOutline, selectSpans, type RecallNeed } from "./outline.js";
import type { ContextStash, ContextStashEntry } from "./stash.js";

const recallNeed = z.object({
  /**
   * What kind of fact to return.
   * `key` matches `NAME=` lines. `text` matches the query literally.
   * `heading` / `symbol` / `error` match the outline label.
   */
  kind: z.enum(["heading", "key", "symbol", "error", "text"]),
  /** Name or literal to find. For `key`, pass the name, not the value. */
  query: z.string().min(1).max(200),
});

const recallInput = z.object({
  /**
   * Stash id from a `[hidden:… · recall_context · …]` marker.
   * Omit to list what is currently hidden.
   */
  id: z.string().min(1).optional(),
  /**
   * Which fact to return. Prefer this over paging the original.
   * The marker lists kinds and names (`key=TOKEN_SKILL@5000`) but not values.
   */
  need: recallNeed.optional(),
  /** Char offset into the original. Only for raw paging. */
  offset: z.number().int().min(0).optional(),
  /**
   * Max characters of the raw original. Only for paging.
   * Default 12_000 when offset or limit is set.
   */
  limit: z.number().int().min(1).max(100_000).optional(),
});

export interface CreateRecallToolOptions {
  /** Default page size when recalling one entry. */
  defaultLimit?: number;
}

/**
 * Tool that fetches originals hidden by the H-M-T context assembler.
 */
export function createRecallTool(
  stash: ContextStash,
  opts: CreateRecallToolOptions = {},
): Tool {
  const defaultLimit = opts.defaultLimit ?? 12_000;

  return defineTool({
    name: "recall_context",
    description: [
      "Retrieve one fact that was folded out of the model view.",
      "Pass `id` from a `[hidden:<id> · recall_context · key=NAME@offset]` marker.",
      "Pass `need` ({kind, query}) to return only the matching lines, not the whole text.",
      "kind is heading, key, symbol, error, or text. For a key, query is the name (TOKEN_SKILL), not its value.",
      "Omit `need` to list the outline. Omit `id` to list hidden entries.",
      "Use offset/limit only to page the raw original.",
    ].join(" "),
    inputSchema: recallInput,
    async execute(input) {
      if (!input.id) {
        const items = stash.list();
        if (!items.length) {
          return {
            content: "No hidden context entries. Nothing to recall.",
          };
        }
        const lines = items.map((e) =>
          [
            `- ${e.id}`,
            `kind=${e.kind}`,
            e.toolName ? `tool=${e.toolName}` : null,
            e.toolCallId ? `call=${e.toolCallId}` : null,
            `chars=${e.charCount}`,
            e.outline.length
              ? `outline=${e.outline
                  .slice(0, 4)
                  .map((item) => `${item.kind}:${item.label}@${item.offset}`)
                  .join(",")}`
              : null,
            `preview=${JSON.stringify(e.preview)}`,
          ]
            .filter(Boolean)
            .join(" "),
        );
        return {
          content: `Hidden context (${items.length}):\n${lines.join("\n")}`,
        };
      }

      const entry = stash.get(input.id);
      if (!entry) {
        const known = stash.list().map((e) => e.id);
        return {
          content: [
            `Unknown id: ${input.id}.`,
            known.length
              ? `Known: ${known.join(", ")}`
              : "Stash is empty.",
          ].join(" "),
          isError: true,
        };
      }

      if (input.need) return recallSelection(entry, input.need);
      if (input.offset !== undefined || input.limit !== undefined) {
        return recallPage(entry, input.offset ?? 0, input.limit ?? defaultLimit);
      }
      return recallOutline(entry);
    },
  });
}

function recallHeader(
  entry: ContextStashEntry,
  extra: Array<string | null>,
): string {
  return [
    `id=${entry.id}`,
    `kind=${entry.kind}`,
    entry.toolName ? `tool=${entry.toolName}` : null,
    `chars=${entry.charCount}`,
    ...extra,
  ]
    .filter(Boolean)
    .join(" ");
}

function recallOutline(entry: ContextStashEntry): { content: string } {
  return {
    content: [
      recallHeader(entry, ["mode=outline"]),
      "Pass need={kind, query} to fetch one span. offset/limit pages the raw original.",
      formatOutline(entry.outline),
    ].join("\n"),
  };
}

function recallSelection(
  entry: ContextStashEntry,
  need: RecallNeed,
): { content: string } {
  const spans = selectSpans(entry.content, entry.outline, need);
  const chunks = spans.map((span) => {
    const text = entry.content.slice(span.start, span.end).replace(/\s+$/, "");
    return `--- offset=${span.start} ---\n${text}`;
  });
  const body = chunks.join("\n\n");
  return {
    content: [
      recallHeader(entry, [
        "mode=select",
        `need=${need.kind}:${need.query}`,
        `hits=${spans.length}`,
        `returned=${body.length}`,
      ]),
      spans.length
        ? body
        : `No match for ${need.kind}:${need.query}.\n${formatOutline(entry.outline)}`,
    ].join("\n\n"),
  };
}

function recallPage(
  entry: ContextStashEntry,
  offset: number,
  limit: number,
): { content: string; isError?: boolean } {
  if (offset >= entry.content.length) {
    return {
      content: `offset ${offset} is past end (chars=${entry.charCount}).`,
      isError: true,
    };
  }
  const slice = entry.content.slice(offset, offset + limit);
  const next = offset + slice.length;
  const hasMore = next < entry.content.length;
  return {
    content: `${recallHeader(entry, [
      "mode=page",
      `offset=${offset}`,
      `returned=${slice.length}`,
      hasMore ? `next_offset=${next}` : "complete",
    ])}\n\n${slice}`,
  };
}

export const RECALL_SYSTEM = [
  "Some older tool outputs may be folded for context budget.",
  "Folded spans look like …[hidden:<id> · recall_context · file=<path> · key=NAME@offset]…",
  "The marker names headings, keys, symbols, and errors, but not their values.",
  "When file= is present, search that file with `rg -n -C 2 -F <NAME> <path>`. Do not read_file it.",
  "Otherwise call recall_context with that id and need={kind, query}. For a key, query is the name, not the value.",
  "A recalled span stays in the view. Do not search or recall the same id again unless the hidden marker comes back.",
].join(" ");

/**
 * `recall_context` tool plus the system hint a host should append.
 */
export function recallContextExtension(
  stash: ContextStash,
  opts: CreateRecallToolOptions = {},
): { tool: Tool; system: string; stash: ContextStash } {
  const tool = createRecallTool(stash, opts);
  return { tool, system: RECALL_SYSTEM, stash };
}
