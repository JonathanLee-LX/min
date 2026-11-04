import { messageText, type Message } from "@min-agent/core";

export const SESSION_TITLE_LIMIT = 80;

export const SESSION_TITLE_SYSTEM = [
  "Name this chat in one short line.",
  "Use the conversation's language.",
  "At most 40 characters.",
  "No quotes and no trailing punctuation.",
].join(" ");

/** Collapse a user-typed name. Empty after trimming stays empty. */
export function cleanSessionTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, SESSION_TITLE_LIMIT);
}

/** First line of a model reply, without wrapping quotes or trailing punctuation. */
export function normalizeSessionTitle(raw: string): string {
  const line = raw
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return "";
  let text = line.replace(/\s+/g, " ").trim();
  for (let pass = 0; pass < 2; pass += 1) {
    text = text.replace(/[.。!！?？]+$/g, "").trim();
    text = text.replace(/^["'`“”「」『』]+|["'`“”「」『』]+$/g, "").trim();
  }
  return text.slice(0, SESSION_TITLE_LIMIT);
}

/** Short transcript for a title call. Not stored on the session. */
export function sessionTitleExcerpt(messages: readonly Message[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = messageText(message).replace(/\s+/g, " ").trim();
    if (!text) continue;
    lines.push(`${message.role}: ${text.slice(0, 240)}`);
  }
  const picked =
    lines.length <= 8 ? lines : [...lines.slice(0, 2), "…", ...lines.slice(-4)];
  return picked.join("\n").slice(0, 2000);
}
