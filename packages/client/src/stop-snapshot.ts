import {
  assistantMessage,
  messageText,
  textPart,
  toolMessage,
  userMessage,
  type Message,
  type ToolResultPart,
} from "@min-agent/core";

export interface StopSnapshotInput {
  /** Canonical messages before the in-flight turn is assigned back. */
  committed: readonly Message[];
  /**
   * Latest Runner transcript. Includes history, this turn's user message,
   * and assistant/tool messages the Runner has already pushed.
   * Null when no turn is in flight.
   */
  transcript: readonly Message[] | null;
  /** Assistant text of the completion that has not been pushed yet. */
  partialText: string;
  /** Tool results observed this turn that may still be sitting in the Runner. */
  toolResults: readonly ToolResultPart[];
  /** Queue texts that have not started. */
  queued: readonly string[];
  /** Fallback user text when the Runner has not published a transcript. */
  userText?: string;
}

/**
 * Session file contents for a stop. Thinking is intentionally absent.
 * A normal `session.run` persist does not see `turnBuf` or the Runner's
 * in-memory messages when the run throws — this assembles that view.
 */
export function assembleStopMessages(input: StopSnapshotInput): Message[] {
  let messages: Message[];
  if (input.transcript && input.transcript.length > 0) {
    messages = input.transcript.map((message) => structuredClone(message));
  } else if (input.userText?.trim()) {
    messages = [
      ...input.committed.map((message) => structuredClone(message)),
      userMessage(input.userText.trim()),
    ];
  } else {
    messages = input.committed.map((message) => structuredClone(message));
  }

  appendMissingToolResults(messages, input.toolResults);

  const partial = input.partialText;
  if (partial) {
    const last = messages.at(-1);
    const lastText = last?.role === "assistant" ? messageText(last) : "";
    if (lastText !== partial) {
      messages.push(assistantMessage([textPart(partial)]));
    }
  }

  for (const text of input.queued) {
    const trimmed = text.trim();
    if (trimmed) messages.push(userMessage(trimmed));
  }
  return messages;
}

function appendMissingToolResults(
  messages: Message[],
  results: readonly ToolResultPart[],
): void {
  if (!results.length) return;
  const present = new Set<string>();
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === "tool_result") present.add(part.toolCallId);
    }
  }
  const missing = results.filter((result) => !present.has(result.toolCallId));
  if (!missing.length) return;
  messages.push(
    toolMessage(missing.map((result) => structuredClone(result))),
  );
}
