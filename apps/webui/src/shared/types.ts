/** Wire shapes shared by the web server and the browser. */

export interface ContextPartView {
  id: string;
  label: string;
  tokens: number;
  share: number;
}

export interface ContextUsageView {
  used: number;
  limit: number;
  ratio: number;
  reservedOutput: number;
  strategy?: string;
  estimated: boolean;
  parts: ContextPartView[];
}

export interface ModelView {
  kind: string;
  model: string;
  effort?: string;
}

export interface WebSkill {
  name: string;
  description: string;
}

export interface WebSnapshot {
  status: "idle" | "running" | "asking";
  busy: boolean;
  provider: string;
  sessionId: string;
  title?: string;
  messageCount: number;
  queueSize: number;
  queue: string[];
  cwd: string;
  /** Home-shortened working directory for the status line. */
  cwdDisplay: string;
  branch?: string;
  context?: ContextUsageView;
  model?: ModelView;
  version: string;
  skills: WebSkill[];
}

export interface SessionRow {
  id: string;
  title?: string;
  updatedAt: string;
  messageCount?: number;
  turns?: number;
  preview?: string;
  latest?: string;
}

export interface ModelRow {
  key: string;
  name: string;
  detail: string;
  current: boolean;
  supportsEffort: boolean;
}

export type SubmitRoute = "empty" | "send" | "queue" | "command" | "blocked";

export interface SubmitResponse {
  ok: boolean;
  route?: SubmitRoute;
  message?: string;
  level?: "sys" | "error";
  error?: string;
  picker?: "sessions" | "models";
  toggle?: "thinking";
  snapshot?: WebSnapshot;
}
