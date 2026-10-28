import type { ClientEvent, ClientHandshake, PermissionAnswer } from "@min-agent/client";
import type { InputQueueMode, SessionMeta } from "@min-agent/session";

export type PermissionMode = "ask" | "yes" | "auto";

export interface MindHello {
  type: "hello";
  protocol: number;
  buildVersion: string;
  pid: number;
}

export interface MindCreateRequest {
  op: "create";
  cwd: string;
  provider?: string;
  model?: string;
  autoApprove?: boolean;
  permissionMode?: PermissionMode;
  sessionId?: string;
  noTools?: boolean;
}

export interface MindLookupRequest {
  op: "lookup";
  sessionId: string;
}

export interface MindDestroyRequest {
  op: "destroy";
  sessionId: string;
}

export interface MindListRequest {
  op: "list";
  cwd: string;
}

export interface MindLeaseRequest {
  op: "lease";
  sessionId: string;
}

export interface MindStopRequest {
  op: "stop";
}

export type MindRequestBody =
  | MindCreateRequest
  | MindLookupRequest
  | MindDestroyRequest
  | MindListRequest
  | MindLeaseRequest
  | MindStopRequest;

export interface MindRequest {
  id: string;
  body: MindRequestBody;
}

export interface LiveClientInfo {
  sessionId: string;
  address: string;
  pid: number;
  cwd: string;
  protocol: number;
  buildVersion: string;
  provider?: string;
  autoApprove: boolean;
}

export interface MindListResult {
  live: LiveClientInfo[];
  history: SessionMeta[];
}

export type MindResponse =
  | { id: string; ok: true; op: "create"; sessionId: string; address: string }
  | { id: string; ok: true; op: "lookup"; sessionId: string; address: string }
  | { id: string; ok: true; op: "lookup-miss"; sessionId: string }
  | { id: string; ok: true; op: "destroy"; sessionId: string }
  | { id: string; ok: true; op: "list"; result: MindListResult }
  | { id: string; ok: true; op: "lease"; sessionId: string }
  | { id: string; ok: true; op: "stop" }
  | { id: string; ok: false; error: string };

export interface ClientRecord {
  sessionId: string;
  pid: number;
  socket: string;
  protocol: number;
  cwd: string;
  buildVersion: string;
  provider?: string;
  autoApprove: boolean;
}

export type ClientProcessRequest =
  | { id: string; op: "send"; text: string }
  | { id: string; op: "abort" }
  | { id: string; op: "permission"; permId: string; answer: PermissionAnswer }
  | { id: string; op: "queue"; text: string; mode?: InputQueueMode }
  | { id: string; op: "queuePeek" }
  | { id: string; op: "queueClear" }
  | { id: string; op: "getStatus" }
  | { id: string; op: "getSession" }
  | { id: string; op: "compact"; keepRecentTurns?: number }
  | { id: string; op: "reset" }
  | { id: string; op: "listSessions" };

export type ClientProcessServerMessage =
  | { type: "snapshot"; snapshot: ClientHandshake }
  | { type: "event"; event: ClientEvent }
  | { type: "res"; id: string; ok: true; result?: unknown }
  | { type: "res"; id: string; ok: false; error: string };
