import type {
  ContentPart,
  DocumentPart,
  ImageMediaType,
  ImagePart,
  Message,
  TextPart,
  ToolCallPart,
  ToolResultPart,
} from "./types.js";

export function textPart(text: string): TextPart {
  return { type: "text", text };
}

export function toolCallPart(
  id: string,
  name: string,
  args: Record<string, unknown>,
): ToolCallPart {
  return { type: "tool_call", id, name, arguments: args };
}

export function toolResultPart(
  toolCallId: string,
  content: string,
  isError = false,
  durationMs?: number,
): ToolResultPart {
  return {
    type: "tool_result",
    toolCallId,
    content,
    isError,
    ...(isRecordedDuration(durationMs) ? { durationMs } : {}),
  };
}

/** Finite, non-negative millisecond count. Missing and invalid values stay absent. */
export function isRecordedDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function userMessage(text: string): Message {
  return { role: "user", content: [textPart(text)] };
}

export function imagePart(input: {
  mediaType: ImageMediaType;
  blobId: string;
  filename?: string;
  data?: Uint8Array;
}): ImagePart {
  return {
    type: "image",
    mediaType: input.mediaType,
    blobId: input.blobId,
    ...(input.filename ? { filename: input.filename } : {}),
    ...(input.data ? { data: input.data } : {}),
  };
}

export function documentPart(input: {
  blobId: string;
  filename?: string;
  data?: Uint8Array;
}): DocumentPart {
  return {
    type: "document",
    mediaType: "application/pdf",
    blobId: input.blobId,
    ...(input.filename ? { filename: input.filename } : {}),
    ...(input.data ? { data: input.data } : {}),
  };
}

export function userMessageWithParts(parts: ContentPart[]): Message {
  return { role: "user", content: parts };
}

export function systemMessage(text: string): Message {
  return { role: "system", content: [textPart(text)] };
}

export function assistantMessage(parts: ContentPart[]): Message {
  return { role: "assistant", content: parts };
}

export function toolMessage(parts: ToolResultPart[]): Message {
  return { role: "tool", content: parts };
}

/** Flatten text parts from a message. */
export function messageText(message: Message): string {
  return message.content
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Collect all tool_call parts from a message. */
export function messageToolCalls(message: Message): ToolCallPart[] {
  return message.content.filter((p): p is ToolCallPart => p.type === "tool_call");
}

/** Last assistant text across a conversation. */
export function lastAssistantText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "assistant") {
      const text = messageText(msg);
      if (text) return text;
    }
  }
  return "";
}
