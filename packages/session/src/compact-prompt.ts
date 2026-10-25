import type { Message } from "@min/core";

/** Flatten messages to a readable transcript for summarization. */
export function messageTextApprox(messages: Message[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const bits: string[] = [];
    for (const part of msg.content) {
      if (part.type === "text") bits.push(part.text);
      else if (part.type === "tool_call") {
        bits.push(
          `tool_call ${part.name}(${JSON.stringify(part.arguments).slice(0, 400)})`,
        );
      } else if (part.type === "tool_result") {
        const body =
          part.content.length > 800
            ? `${part.content.slice(0, 400)}…(${part.content.length} chars)…${part.content.slice(-200)}`
            : part.content;
        bits.push(`tool_result ${part.toolCallId}: ${body}`);
      }
    }
    lines.push(`${msg.role}: ${bits.join(" | ")}`);
  }
  return lines.join("\n");
}
