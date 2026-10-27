import type { RunEvent } from "@min-agent/core";
import type { ClientEvent } from "./types.js";

export interface EventTranslator {
  /** Map one RunEvent; may yield 0..n ClientEvents. */
  push(event: RunEvent): ClientEvent[];
  /** Reset per-turn tool name bookkeeping. */
  reset(): void;
}

/** Translate core RunEvent stream into display-oriented ClientEvent. */
export function createEventTranslator(): EventTranslator {
  const toolNames = new Map<string, string>();

  return {
    reset() {
      toolNames.clear();
    },

    push(event) {
      switch (event.type) {
        case "text_delta":
          return [{ type: "assistant_delta", text: event.text }];

        case "thinking_delta":
          return [{ type: "thinking_delta", text: event.text }];

        case "tool_call": {
          toolNames.set(event.toolCall.id, event.toolCall.name);
          return [
            {
              type: "tool_start",
              name: event.toolCall.name,
              args: event.toolCall.arguments,
              toolCallId: event.toolCall.id,
            },
          ];
        }

        case "tool_result": {
          const preview = event.content.replace(/\s+/g, " ").trim();
          const clipped =
            preview.length > 200 ? `${preview.slice(0, 197)}...` : preview;
          return [
            {
              type: "tool_end",
              toolCallId: event.toolCallId,
              name: toolNames.get(event.toolCallId),
              ok: !event.isError,
              preview: clipped,
              content: event.content,
            },
          ];
        }

        case "error":
          if (!event.error) return [];
          return [
            {
              type: "error",
              message: event.error.message,
              aborted: isAbortError(event.error),
            },
          ];

        // turn_start / turn_end / done / permission(decision) — not UI-facing here.
        // Interactive asks go through the permission bridge, not RunEvent.permission.
        default:
          return [];
      }
    },
  };
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return e.name === "AbortError" || /aborted/i.test(e.message ?? "");
}

export function previewArgs(args: Record<string, unknown>, max = 80): string {
  const raw = JSON.stringify(args);
  return raw.length > max ? `${raw.slice(0, max - 3)}...` : raw;
}
