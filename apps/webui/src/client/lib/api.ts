import type { ModelRow, ModelView, SessionRow, SubmitResponse, WebSnapshot } from "../../shared/types";

async function read(res: Response): Promise<SubmitResponse> {
  const data = (await res.json().catch(() => ({}))) as Partial<SubmitResponse>;
  const ok = typeof data.ok === "boolean" ? data.ok : res.ok;
  return {
    ...data,
    ok,
    ...(ok ? {} : { error: data.error ?? res.statusText }),
  };
}

export function submitText(text: string): Promise<SubmitResponse> {
  return fetch("/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).then(read);
}

export function openSession(id: string): Promise<SubmitResponse> {
  return fetch("/api/sessions/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  }).then(read);
}

export function newSession(): Promise<SubmitResponse> {
  return fetch("/api/sessions/new", { method: "POST" }).then(read);
}

export function selectModel(key: string, effort?: string): Promise<SubmitResponse> {
  return fetch("/api/model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, effort }),
  }).then(read);
}

export async function fetchSessions(): Promise<SessionRow[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error(res.statusText);
  const data = (await res.json()) as { sessions: SessionRow[] };
  return data.sessions;
}

export async function fetchModels(): Promise<{ models: ModelRow[]; model: ModelView | null }> {
  const res = await fetch("/api/models");
  if (!res.ok) throw new Error(res.statusText);
  return (await res.json()) as { models: ModelRow[]; model: ModelView | null };
}

export function answerPermission(
  id: string,
  answer: "allow" | "deny" | "allow_session",
): Promise<void> {
  return fetch("/api/permission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, answer }),
  }).then(() => undefined);
}

export function abortRun(): Promise<void> {
  return fetch("/api/abort", { method: "POST" }).then(() => undefined);
}

export type { WebSnapshot };
