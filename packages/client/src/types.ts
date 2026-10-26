import type { Message, ToolCallPart } from "@min/core";
import type { Runtime, RuntimeOptions } from "@min/runtime";
import type { InputQueueMode, SessionMeta } from "@min/session";

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
      preview: string;
    }
  | { type: "follow_up"; texts: readonly string[] }
  | {
      type: "permission";
      id: string;
      reason: string;
      toolCall: ToolCallPart;
      grantRoot?: string;
    }
  | { type: "queued"; text: string; queueSize: number }
  | { type: "error"; message: string; aborted?: boolean }
  | {
      type: "session";
      id: string;
      title?: string;
      messageCount: number;
      reason: SessionEventReason;
      /**
       * Full transcript when switching/clearing sessions so UIs can rebuild
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

  /** Deny unanswered permission asks after this many ms. Default 120_000. */
  permissionTimeoutMs?: number;
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

  reset(): void;
  getSession(): ClientSessionInfo;
  listSessions(): Promise<SessionMeta[]>;
  /**
   * Switch to another stored session id.
   * Disposes the current session handle and rebuilds via Runtime options.
   * Emits `session` with `reason: "open"` and full `messages`.
   */
  openSession(id: string): Promise<void>;
  /**
   * Start a fresh session (new id). Requires Client-owned Runtime.
   * Emits `session` with `reason: "new"`.
   */
  newSession(): Promise<void>;

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
   * Escape hatch for advanced hosts. Prefer not to use from ordinary UI code.
   */
  readonly advanced: {
    runtime: Runtime;
  };
}
