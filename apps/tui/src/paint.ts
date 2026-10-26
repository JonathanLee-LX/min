import type { LogKind } from "./transcript.js";
import { displayWidth, wrapText } from "./text.js";

/** Speaker column. Labels are ASCII and pad out to this many cells. */
const GUTTER = 5;

const LABELS: Record<Exclude<LogKind, "gap">, string> = {
  user: "you",
  assistant: "min",
  tool: "tool",
  "tool-result": "ok",
  "tool-error": "fail",
  error: "err",
  notice: "note",
  sys: "sys",
};

export interface TranscriptSource {
  key: string;
  kind: LogKind;
  text: string;
}

export interface PaintedRow {
  key: string;
  kind: LogKind;
  /** First visual row of a message carries the speaker label. */
  lead: boolean;
  gutter: string;
  body: string;
  /** Full row, used by the viewport measurer. */
  text: string;
}

export interface LineTone {
  label?: string;
  body?: string;
  dimLabel: boolean;
  dimBody: boolean;
}

/**
 * Answers stay bright. Tool traffic, notes, and session chrome step down
 * so a long tool log does not drown the reply.
 */
export function toneFor(kind: LogKind): LineTone {
  switch (kind) {
    case "user":
      return { label: "green", body: "green", dimLabel: false, dimBody: false };
    case "assistant":
      return { label: "cyan", dimLabel: false, dimBody: false };
    case "tool":
      return { label: "cyan", body: "cyan", dimLabel: false, dimBody: false };
    case "tool-result":
      return { label: "gray", body: "gray", dimLabel: true, dimBody: true };
    case "tool-error":
    case "error":
      return { label: "red", body: "red", dimLabel: false, dimBody: false };
    case "notice":
      return { label: "yellow", body: "yellow", dimLabel: false, dimBody: false };
    case "sys":
      return { dimLabel: true, dimBody: true };
    case "gap":
      return { dimLabel: true, dimBody: true };
  }
}

/** Blank line before each new user or assistant turn. */
export function separateTurns(lines: readonly TranscriptSource[]): TranscriptSource[] {
  const out: TranscriptSource[] = [];
  let prev: LogKind | undefined;
  for (const line of lines) {
    if (prev && isTurn(line.kind) && line.kind !== prev) {
      out.push({ key: `${line.key}:gap`, kind: "gap", text: "" });
    }
    out.push(line);
    if (line.kind !== "gap") prev = line.kind;
  }
  return out;
}

export function paintTranscript(
  lines: readonly TranscriptSource[],
  columns: number,
): PaintedRow[] {
  const rows: PaintedRow[] = [];
  for (const line of separateTurns(lines)) rows.push(...paintOne(line, columns));
  return rows;
}

function paintOne(line: TranscriptSource, columns: number): PaintedRow[] {
  if (line.kind === "gap") {
    return [
      {
        key: line.key,
        kind: "gap",
        lead: false,
        gutter: "",
        body: " ",
        text: " ",
      },
    ];
  }
  const gutter = LABELS[line.kind].padEnd(GUTTER, " ");
  const blank = " ".repeat(GUTTER);
  const bodyWidth = Math.max(1, columns - GUTTER);
  const parts = wrapText(line.text.length > 0 ? line.text : " ", bodyWidth);
  return parts.map((body, index) => {
    const lead = index === 0;
    const prefix = lead ? gutter : blank;
    return {
      key: `${line.key}:${index}`,
      kind: line.kind,
      lead,
      gutter: prefix,
      body,
      text: prefix + body,
    };
  });
}

function isTurn(kind: LogKind): boolean {
  return kind === "user" || kind === "assistant";
}

export type ActivityPhase = "thinking" | "writing" | "tool" | "continuing" | "approval";

export interface Activity {
  phase: ActivityPhase;
  label: string;
  frames: readonly string[];
  intervalMs: number;
  color: string;
}

const FRAMES: Record<ActivityPhase, readonly string[]> = {
  thinking: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  writing: ["▁", "▃", "▅", "▇", "▅", "▃"],
  tool: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"],
  continuing: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
  approval: ["◐", "◓", "◑", "◒"],
};

export function activityFrames(phase: ActivityPhase): readonly string[] {
  return FRAMES[phase];
}

export function activityFor(input: {
  status: "idle" | "running" | "asking";
  streaming: boolean;
  toolName: string | null;
  continuing: boolean;
}): Activity | null {
  if (input.status === "asking") {
    return spec("approval", "waiting for approval", "yellow", 140);
  }
  if (input.status !== "running") return null;
  if (input.toolName) return spec("tool", clipLabel(input.toolName), "cyan", 80);
  if (input.streaming) return spec("writing", "writing", "cyan", 140);
  if (input.continuing) return spec("continuing", "continuing", "yellow", 140);
  return spec("thinking", "thinking", "magenta", 80);
}

export function frameChar(activity: Activity, frame: number): string {
  const frames = activity.frames;
  return frames[frame % frames.length] ?? frames[0] ?? "·";
}

function clipLabel(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= 36) return flat;
  return `${flat.slice(0, 33)}...`;
}

function spec(phase: ActivityPhase, label: string, color: string, intervalMs: number): Activity {
  const frames = FRAMES[phase];
  for (const frame of frames) {
    if (displayWidth(frame) !== 1) {
      throw new Error(`spinner frame ${frame} for ${phase} is not one cell wide`);
    }
  }
  return { phase, label, frames, intervalMs, color };
}
