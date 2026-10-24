import {
  defineExtension,
  defineTool,
  type Extension,
  type Tool,
} from "@min/core";
import { z } from "zod";
import type { ContextStash } from "./stash.js";

const recallInput = z.object({
  /**
   * Stash id from a `[hidden:… · recall_context]` marker.
   * Omit to list what is currently hidden.
   */
  id: z.string().min(1).optional(),
  /** Byte/char offset into the original content. Default 0. */
  offset: z.number().int().min(0).optional(),
  /**
   * Max characters to return. Default 12_000.
   * Use with offset to page through large blobs.
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
      "Retrieve original context that was folded/hidden from the model view.",
      "Pass `id` from a `[hidden:<id> · recall_context]` marker.",
      "Omit `id` to list available hidden entries (id, kind, tool, size, preview).",
      "Use offset/limit to page through large payloads.",
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

      const offset = input.offset ?? 0;
      const limit = input.limit ?? defaultLimit;
      if (offset >= entry.content.length) {
        return {
          content: `offset ${offset} is past end (chars=${entry.charCount}).`,
          isError: true,
        };
      }
      const slice = entry.content.slice(offset, offset + limit);
      const next = offset + slice.length;
      const hasMore = next < entry.content.length;
      const header = [
        `id=${entry.id}`,
        `kind=${entry.kind}`,
        entry.toolName ? `tool=${entry.toolName}` : null,
        `chars=${entry.charCount}`,
        `offset=${offset}`,
        `returned=${slice.length}`,
        hasMore ? `next_offset=${next}` : "complete",
      ]
        .filter(Boolean)
        .join(" ");

      return { content: `${header}\n\n${slice}` };
    },
  });
}

/**
 * Agent extension: registers `recall_context` and a short system hint.
 */
export function recallContextExtension(
  stash: ContextStash,
  opts: CreateRecallToolOptions = {},
): Extension & { tool: Tool; stash: ContextStash } {
  const tool = createRecallTool(stash, opts);
  const ext = defineExtension({
    name: "recall-context",
    setup(api) {
      api.registerTool(tool);
      api.appendSystem(
        [
          "Some older tool outputs may be folded in the middle of the conversation for context budget.",
          "Folded spans look like …[hidden:<id> · recall_context]…",
          "Call recall_context with that id when you need the full original; omit id to list what is hidden.",
        ].join(" "),
      );
    },
  });
  return Object.assign(ext, { tool, stash });
}
