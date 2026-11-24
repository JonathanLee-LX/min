import type { RunEvent, ToolCallPart } from "@min-agent/core";
import { formatLiveToolDuration, formatToolDuration, recordedDuration } from "./duration.js";

export interface EventPrinter {
  onEvent: (event: RunEvent) => void;
  /** True if any assistant text_delta was written this turn. */
  didStreamText: () => boolean;
  /** Ensure a trailing newline after streamed text before tool/status lines. */
  endTextLine: () => void;
}

/** Stream assistant text to stdout; tool/permission events to stderr-friendly console. */
export function createEventPrinter(): EventPrinter {
  let streamingText = false;
  let sawText = false;
  let live: { id: string; timer?: ReturnType<typeof setInterval> } | undefined;

  const endTextLine = () => {
    if (streamingText) {
      process.stdout.write("\n");
      streamingText = false;
    }
  };

  const stopLive = (id?: string) => {
    if (!live) return;
    if (id && live.id !== id) return;
    if (live.timer) clearInterval(live.timer);
    if (live.timer && process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
    live = undefined;
  };

  const beginLive = (call: ToolCallPart) => {
    stopLive();
    endTextLine();
    const started = Date.now();
    if (!process.stdout.isTTY) {
      live = { id: call.id };
      return;
    }
    const draw = () => {
      const label = `→ ${call.name}  ${formatLiveToolDuration(Date.now() - started)}`;
      process.stdout.write(`\r\x1b[2K${label}`);
    };
    draw();
    const timer = setInterval(draw, 100);
    timer.unref?.();
    live = { id: call.id, timer };
  };

  return {
    didStreamText: () => sawText,
    endTextLine,
    onEvent(event) {
      if (event.type === "text_delta") {
        if (!streamingText) {
          process.stdout.write("\n");
          streamingText = true;
        }
        process.stdout.write(event.text);
        sawText = true;
        return;
      }

      endTextLine();

      if (event.type === "tool_call") {
        if (event.phase === "running") {
          beginLive(event.toolCall);
          return;
        }
        const args = JSON.stringify(event.toolCall.arguments);
        const clipped = args.length > 120 ? `${args.slice(0, 117)}...` : args;
        console.log(`\n→ ${event.toolCall.name}(${clipped})`);
      } else if (event.type === "tool_result") {
        stopLive(event.toolCallId);
        const body = event.content.replace(/\s+/g, " ").trim();
        const clipped = body.length > 160 ? `${body.slice(0, 157)}...` : body;
        const duration = recordedDuration(event.durationMs);
        const time = duration !== undefined ? `${formatToolDuration(duration)}  ` : "";
        console.log(`← ${event.isError ? "ERR " : ""}${time}${clipped}`);
      } else if (event.type === "error" && event.error) {
        // Runner also throws; keep a short line for visibility during stream.
        if (!isQuietAbort(event.error)) {
          console.error(`error: ${event.error.message}`);
        }
      }
    },
  };
}

function isQuietAbort(err: Error): boolean {
  return err.name === "AbortError" || /aborted/i.test(err.message);
}
