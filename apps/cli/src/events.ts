import type { RunEvent } from "@min-agent/core";

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

  const endTextLine = () => {
    if (streamingText) {
      process.stdout.write("\n");
      streamingText = false;
    }
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
        const args = JSON.stringify(event.toolCall.arguments);
        const clipped = args.length > 120 ? `${args.slice(0, 117)}...` : args;
        console.log(`\n→ ${event.toolCall.name}(${clipped})`);
      } else if (event.type === "tool_result") {
        const body = event.content.replace(/\s+/g, " ").trim();
        const clipped = body.length > 160 ? `${body.slice(0, 157)}...` : body;
        console.log(`← ${event.isError ? "ERR " : ""}${clipped}`);
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
