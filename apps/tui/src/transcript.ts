import { wrapText } from "./text.js";

export interface TranscriptMessage {
  role: string;
  content: readonly TranscriptPart[];
}

export type TranscriptPart =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; arguments: unknown }
  | { type: "tool_result"; content: string; isError?: boolean };

export type LogKind =
  | "user"
  | "assistant"
  | "tool"
  | "tool-result"
  | "tool-error"
  | "error"
  | "notice"
  | "sys"
  | "gap";

export interface LogLine {
  id: number;
  kind: LogKind;
  text: string;
}

export function linesFromMessages(
  messages: readonly TranscriptMessage[],
): Array<Omit<LogLine, "id">> {
  const lines: Array<Omit<LogLine, "id">> = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    for (const part of message.content) {
      if (part.type === "text") {
        const text = part.text.trim();
        if (!text) continue;
        const kind: LogKind =
          message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : "tool";
        lines.push({ kind, text });
        continue;
      }
      if (part.type === "tool_call") {
        lines.push({
          kind: "tool",
          text: summarizeToolCall(part.name, part.arguments),
        });
        continue;
      }
      if (part.type === "tool_result") {
        const text = brief(part.content, 1000);
        lines.push({
          kind: part.isError ? "tool-error" : "tool-result",
          text: text || (part.isError ? "(failed)" : "(no output)"),
        });
      }
    }
  }
  return lines;
}

export interface ViewportRow<T> {
  source: T;
  text: string;
}

/**
 * `scroll` is visual rows hidden below the viewport. `0` is pinned to the bottom.
 * Lines are pre-wrapped so PageUp moves by cells, including inside a long message.
 */
export function layoutViewport<T extends { text: string }>(
  lines: readonly T[],
  columns: number,
  height: number,
  scroll: number,
): {
  visible: Array<ViewportRow<T>>;
  scroll: number;
  hiddenAbove: number;
  hiddenBelow: number;
  total: number;
} {
  const rowHeight = Math.max(1, height);
  const visual: Array<ViewportRow<T>> = [];
  for (const source of lines) {
    for (const text of wrapText(source.text, columns)) {
      visual.push({ source, text });
    }
  }
  const total = visual.length;
  const maxScroll = Math.max(0, total - rowHeight);
  const clamped = Math.min(Math.max(0, scroll), maxScroll);
  const end = total - clamped;
  const start = Math.max(0, end - rowHeight);
  return {
    visible: visual.slice(start, end),
    scroll: clamped,
    hiddenAbove: start,
    hiddenBelow: clamped,
    total,
  };
}

export function transcriptRowCount(
  lines: readonly { text: string }[],
  columns: number,
): number {
  let total = 0;
  for (const line of lines) total += wrapText(line.text, columns).length;
  return total;
}

const SALIENT_ARG = ["command", "cmd", "path", "file_path", "file", "pattern", "query", "url", "skill", "name"];

/** Tool name plus the one argument a person scans for, not the raw payload. */
export function summarizeToolCall(name: string, args: unknown): string {
  const detail = salientArg(args);
  return detail ? `${name}  ${detail}` : name;
}

function salientArg(args: unknown): string {
  if (typeof args === "string") return brief(args, 72);
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    const raw = brief(args, 72);
    return raw === "" || raw === "{}" || raw === "undefined" ? "" : raw;
  }
  const record = args as Record<string, unknown>;
  for (const key of SALIENT_ARG) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return brief(value, 72);
  }
  const raw = brief(record, 72);
  return raw === "{}" ? "" : raw;
}

function brief(value: unknown, max: number): string {
  const raw = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  const flat = raw.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 3)}...`;
}
