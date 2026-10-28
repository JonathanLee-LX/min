import type { Message, ToolCallPart } from "@min-agent/core";
import type { Runtime, RuntimeOptions } from "@min-agent/runtime";
import type { InputQueueMode, SessionMeta, SessionSnapshot } from "@min-agent/session";

/** Client lifecycle / interaction status exposed to UIs. */
export type ClientStatus = "idle" | "running" | "asking";

/** Busy-send policy when `send` is called while a run is in progress. */
export type OnBusySend = "queue" | "reject";

export type PermissionAnswer = "allow" | "deny" | "allow_session";

export interface ClientSessionInfo {
  id: string;
  title?: string;
  messageCount: number;
  /** Canonical messages (full history). Prefer for transcript rebuild. */
  messages: readonly Message[];
}

/** Why a `session` ClientEvent was emitted. */
export type SessionEventReason =
  | "update"
  | "open"
  | "reset"
  | "new"
  | "compact";

export interface ClientStatusSnapshot {
  status: ClientStatus;
  busy: boolean;
  provider: string;
  sessionId: string;
  queueSize: number;
  cwd: string;
  /** Latest assemble context meter, when available. */
  context?: import("@min-agent/session").ContextUsage;
}

export interface ClientQueueApi {
  push(text: string, opts?: { mode?: InputQueueMode }): void;
  peek(): readonly string[];
  clear(): void;
  readonly size: number;
}

/**
 * Display-oriented events. Translated from RunEvent / Session lifecycle.
 * UIs should subscribe to these — not parse RunEvent directly.
 */
export type ClientEvent =
  | { type: "status"; status: ClientStatus }
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_done"; text: string }
  /** Live model reasoning; not stored in session messages. */
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_done"; text: string }
  | {
      type: "tool_start";
      name: string;
      args: Record<string, unknown>;
      toolCallId: string;
    }
  | {
      type: "tool_end";
      toolCallId: string;
      name?: string;
      ok: boolean;
      /** One-line preview for compact logs. */
      preview: string;
      /** Full tool output, newlines included. */
      content: string;
    }
  | { type: "follow_up"; texts: readonly string[] }
  | {
      type: "permission";
      id: string;
      reason: string;
      toolCall: ToolCallPart;
      grantRoot?: string;
    }
  | {
      type: "permission_answer";
      id: string;
      answer: PermissionAnswer;
    }
  | { type: "queued"; text: string; queueSize: number }
  | { type: "error"; message: string; aborted?: boolean }
  | {
      type: "context";
      usage: import("@min-agent/session").ContextUsage;
    }
  | {
      type: "session";
      id: string;
      title?: string;
      messageCount: number;
      reason: SessionEventReason;
      /**
       * Full transcript when clearing or compacting so UIs can rebuild
       * without calling getSession(). Omitted on per-turn `update`.
       */
      messages?: readonly Message[];
    };

export type ClientEventHandler = (event: ClientEvent) => void;

export interface SendOptions {
  signal?: AbortSignal;
}

export interface ClientOptions {
  /** Assemble a new Runtime (ignored when `runtime` is provided). */
  cwd?: string;
  provider?: RuntimeOptions["provider"];
  sessionId?: string;
  sessionDir?: string;
  noSessionStore?: boolean;
  noTools?: boolean;
  skillsDir?: string;
  addRoots?: string[];
  askWrite?: boolean;
  allowBash?: boolean;
  maxContextTokens?: number;
  maxUserTurns?: number;
  /** Max model completes per user message. Default: 40. */
  maxTurns?: number;
  /**
   * Continuous assemble strategy.
   * Default (via Runtime): `hybrid` with tools, `trim` without.
   */
  contextStrategy?: RuntimeOptions["contextStrategy"];
  sessionExtensions?: RuntimeOptions["sessionExtensions"];

  /** Inject an already-composed Runtime (tests / custom hosts). */
  runtime?: Runtime;

  /**
   * When `send` arrives while busy:
   * - `queue` (default): push into session input queue
   * - `reject`: throw
   */
  onBusySend?: OnBusySend;

  /**
   * Auto-answer permission without emitting `permission` events.
   * Useful for non-interactive / `--yes` hosts.
   */
  autoApprovePermission?:
    | boolean
    | ((req: {
        toolCall: ToolCallPart;
        reason: string;
        grantRoot?: string;
      }) => Promise<PermissionAnswer> | PermissionAnswer);

  /** Optional transform / filter after internal mapping. */
  mapEvent?: (event: ClientEvent) => ClientEvent | null;

  /**
   * When true, approving a root grant also calls `permissions.grantRoot`.
   * Hosts that manage roots themselves can leave this false (default true).
   */
  applyRootGrant?: boolean;

  /**
   * When true (default), `allow_session` writes the remembered pattern or
   * root into `.min/permissions.json`. Set false for `--auto`, which should
   * only remember for this process.
   */
  persistPermissionGrants?: boolean;

  /** Deny unanswered permission asks after this many ms. Default 120_000. */
  permissionTimeoutMs?: number;

  /**
   * Client-process stop path only: called with the assembled shutdown snapshot
   * after freeze/abort and before persist. Not invoked on a normal turn persist.
   * Cannot cancel exit; throw or timeout (2s) and persist still proceeds.
   */
  onBeforeShutdown?: (snapshot: SessionSnapshot) => void | Promise<void>;
}

/** Pending permission as seen by a newly attached frontend. */
export interface HandshakePermission {
  id: string;
  reason: string;
  toolCall: ToolCallPart;
  grantRoot?: string;
}

/**
 * First message on a client-process connection, then live `ClientEvent`s.
 * Thinking is included here and is not written to the session file.
 */
export interface ClientHandshake {
  session: ClientSessionInfo;
  status: ClientStatusSnapshot;
  turn: { text: string; thinking: string };
  pendingPermissions: readonly HandshakePermission[];
  queue: readonly string[];
}

/**
 * UI-facing facade — the experience contract between apps and the engine.
 *
 * Goals: unify top-level UX across CLI/TUI/WebUI, hide Session/Core details,
 * and keep layers decoupled. Does not replace Runtime (composition) or
 * Session (history / queue authority).
 */
export interface MinClient {
  readonly queue: ClientQueueApi;

  send(text: string, opts?: SendOptions): Promise<void>;
  abort(): void;
  dispose(): Promise<void>;

  getStatus(): ClientStatusSnapshot;
  subscribe(handler: ClientEventHandler): () => void;

  respondPermission(id: string, answer: PermissionAnswer): void;

  /**
   * Clear messages and the queue for this same session id. Does not mint a
   * new id — switching sessions is a new client process via mind.
   */
  reset(): void;
  getSession(): ClientSessionInfo;
  /**
   * List stored sessions for this process's workspace store.
   * Interactive hosts list via mind instead of this method.
   */
  listSessions(): Promise<SessionMeta[]>;

  /**
   * Explicit on-demand history compact (LLM summary + rewrite store).
   * Not a continuous context strategy. Emits `session` with `reason: "compact"`.
   */
  compact(opts?: {
    keepRecentTurns?: number;
    signal?: AbortSignal;
  }): Promise<{
    summary: string;
    droppedMessageCount: number;
    keptTurns: number;
    messageCount: number;
  }>;

  /**
   * Escape hatch for in-process hosts. Not present on the client-process wire.
   */
  readonly advanced: {
    runtime: Runtime;
  };
}
