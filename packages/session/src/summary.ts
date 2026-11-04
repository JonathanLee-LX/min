import { messageText, type Message } from "@min-agent/core";
import type { SessionMeta, SessionSnapshot } from "./store.js";

/** List row. Extra fields are derived at list time and are not stored. */
export interface SessionSummary extends SessionMeta {
  messageCount: number;
  /** User messages. */
  turns: number;
  /** First user line, else the saved title. */
  preview?: string;
  /** Last user line when it is not the same as `preview`. */
  latest?: string;
}

const STORED_PREVIEW = 180;

export function summarizeSession(snapshot: SessionSnapshot): SessionSummary {
  const messages = snapshot.messages ?? [];
  const userLines = userTexts(messages);
  const preview = clipStored(userLines[0] || snapshot.meta.title || "");
  const last = userLines[userLines.length - 1] ?? "";
  const latest = last && last !== preview ? clipStored(last) : "";
  return {
    ...snapshot.meta,
    messageCount: messages.length,
    turns: userLines.length,
    ...(preview ? { preview } : {}),
    ...(latest ? { latest } : {}),
  };
}

function userTexts(messages: readonly Message[]): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = messageText(message).replace(/\s+/g, " ").trim();
    if (text) lines.push(text);
  }
  return lines;
}

function clipStored(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= STORED_PREVIEW) return clean;
  return `${clean.slice(0, STORED_PREVIEW - 1)}…`;
}
