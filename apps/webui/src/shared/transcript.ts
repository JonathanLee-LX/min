export interface TranscriptMessage {
  role: string;
  content: readonly TranscriptPart[];
}

export type TranscriptPart =
  | { type: "text"; text: string }
  | { type: "image"; filename?: string; blobId?: string }
  | { type: "document"; filename?: string; blobId?: string }
  | { type: "tool_call"; name: string; arguments: unknown }
  | { type: "tool_result"; content: string; isError?: boolean };

export type LogKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "tool-result"
  | "tool-error"
  | "error"
  | "notice"
  | "sys";

export interface LogLine {
  id: string;
  kind: LogKind;
  text: string;
}

const SALIENT_ARG = [
  "command",
  "cmd",
  "path",
  "file_path",
  "file",
  "pattern",
  "query",
  "url",
  "skill",
  "name",
];

export function linesFromMessages(
  messages: readonly TranscriptMessage[],
): Array<Omit<LogLine, "id">> {
  const lines: Array<Omit<LogLine, "id">> = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    for (const part of message.content ?? []) {
      if (part.type === "text") {
        const text = part.text.trim();
        if (!text) continue;
        const kind: LogKind =
          message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : "tool";
        lines.push({ kind, text });
        continue;
      }
      if (part.type === "image" || part.type === "document") {
        const name = part.filename?.trim() || (part.type === "image" ? "image" : "document.pdf");
        lines.push({
          kind: message.role === "user" ? "user" : "sys",
          text: `${part.type} ${name}`,
        });
        continue;
      }
      if (part.type === "tool_call") {
        lines.push({ kind: "tool", text: summarizeToolCall(part.name, part.arguments) });
        continue;
      }
      if (part.type === "tool_result") {
        const text = part.content.trim();
        lines.push({
          kind: part.isError ? "tool-error" : "tool-result",
          text: text || (part.isError ? "(failed)" : "(no output)"),
        });
      }
    }
  }
  return lines;
}

export function summarizeToolCall(name: string, args: unknown): string {
  const detail = salientArg(args);
  return detail ? `${name}  ${detail}` : name;
}

export function isTranscriptMessage(value: unknown): value is TranscriptMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as { role?: unknown; content?: unknown };
  return typeof message.role === "string" && Array.isArray(message.content);
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

function formatRunDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

export function activityLabel(input: {
  status: "idle" | "running" | "asking";
  streaming: boolean;
  toolName: string | null;
  continuing: boolean;
  nowMs?: number;
  runStartedAtMs?: number | null;
  workedDurationMs?: number | null;
  workedVisible?: boolean;
}): string | null {
  if (input.workedVisible && input.workedDurationMs != null && input.workedDurationMs >= 0) {
    return `Worked for ${formatRunDuration(input.workedDurationMs)}`;
  }
  if (input.status !== "running" && input.status !== "asking") return null;
  const now = input.nowMs ?? Date.now();
  if (input.runStartedAtMs != null) {
    return `Working... (${formatRunDuration(Math.max(0, now - input.runStartedAtMs))})`;
  }
  return "Working...";
}
