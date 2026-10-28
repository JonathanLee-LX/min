import {
  assistantMessage,
  messageText,
  textPart,
  userMessage,
  type Message,
} from "@min-agent/core";
import type { SessionSnapshot } from "@min-agent/session";

function cloneMessage(message: Message): Message {
  return {
    role: message.role,
    content: message.content.map((part) => ({ ...part })),
  };
}

/**
 * Assemble the session file written on client-process SIGTERM.
 *
 * Includes committed history, the in-flight user/tool turns copied from the
 * Runner, frozen assistant text (not thinking), and queued inputs that have
 * not started. Does not auto-rerun on the next create.
 */
export function buildShutdownSnapshot(input: {
  committed: SessionSnapshot;
  inflight?: readonly Message[];
  turnText: string;
  queued: readonly string[];
}): SessionSnapshot {
  let messages: Message[] = (input.inflight ?? input.committed.messages).map(
    cloneMessage,
  );

  const text = input.turnText;
  if (text) {
    const last = messages.at(-1);
    const already =
      last?.role === "assistant" && messageText(last).includes(text);
    if (!already) {
      if (last?.role === "assistant") {
        messages = [
          ...messages.slice(0, -1),
          {
            role: "assistant",
            content: [textPart(text), ...last.content],
          },
        ];
      } else {
        messages = [...messages, assistantMessage([textPart(text)])];
      }
    }
  }

  for (const item of input.queued) {
    const trimmed = item.trim();
    if (trimmed) messages = [...messages, userMessage(trimmed)];
  }

  return {
    meta: {
      ...input.committed.meta,
      updatedAt: new Date().toISOString(),
    },
    messages,
  };
}
