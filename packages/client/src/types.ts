import type { Message, Notice, ToolCallPart } from "@min-agent/core";
import type { Runtime, RuntimeOptions } from "@min-agent/runtime";
import type { InputQueueMode, SessionSummary } from "@min-agent/session";

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
  | "compact"
  | "rename";

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
       * Full transcript when switching/clearing sessions so UIs can rebuild
       * without calling getSession(). Omitted on per-turn `update`.
       */
      messages?: readonly Message[];
    };

export type ClientEventHandler = (event: ClientEvent) => void;

export interface SendOptions {
  signal?: AbortSignal;
  /**
   * Image, PDF, or text files for this turn. Bytes are stored as session
   * blobs; the first `send` argument stays a string.
   */
  attachments?: readonly {
    filename?: string;
    mediaType?: string;
    bytes: Uint8Array;
  }[];
}

export interface ClientOptions {
  /** Assemble a new Runtime (ignored when `runtime` is provided). */
  cwd?: string;
  provider?: RuntimeOptions["provider"];
  sessionId?: string;
  sessionDir?: string;
  noSessionStore?: boolean;
  noTools?: boolean;
  home?: string;
  skillsDir?: string;
  skillsDirs?: string[];
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
}

/**
 * UI-facing facade — the experience contract between apps and the engine.
 *
 * Goals: unify top-level UX across CLI/TUI/WebUI, hide Session/Core details,
 * and keep layers decoupled. Does not replace Runtime (composition) or
 * Session (history / queue authority).
 */
/**
 * View-facing handle on the process notice log.
 * `list` is a snapshot. `subscribe` receives notices recorded after the call.
 */
export interface ClientNotices {
  list(): readonly Notice[];
  subscribe(handler: (notice: Notice) => void): () => void;
}

export interface ClientSkill {
  name: string;
  description: string;
}

export interface MinClient {
  readonly queue: ClientQueueApi;
  /** System notices collected before and during this process. */
  readonly notices: ClientNotices;

  send(text: string, opts?: SendOptions): Promise<void>;
  abort(): void;
  dispose(): Promise<void>;

  /** Skills available as `/name` slash commands. Built-in commands still win. */
  listSkills(): readonly ClientSkill[];

  getStatus(): ClientStatusSnapshot;
  subscribe(handler: ClientEventHandler): () => void;

  respondPermission(id: string, answer: PermissionAnswer): void;

  reset(): void;
  getSession(): ClientSessionInfo;
  listSessions(): Promise<SessionSummary[]>;
  /**
   * Switch to a stored session. An exact id or a unique prefix matches.
   * Unknown and ambiguous ids throw and leave the current session in place.
   * The current id is a no-op. Otherwise disposes the session handle and rebuilds.
   * Emits `session` with `reason: "open"` and full `messages`.
   */
  openSession(id: string): Promise<void>;
  /**
   * Start a fresh session (new id). Requires Client-owned Runtime.
   * Emits `session` with `reason: "new"`.
   */
  newSession(): Promise<void>;

  /**
   * Set the session name. The first user message is the default until this runs.
   * Emits `session` with `reason: "rename"`.
   */
  renameSession(title: string): Promise<void>;
  /**
   * Ask the current model for a short name. The request is not stored as a turn.
   * Emits `session` with `reason: "rename"`.
   */
  generateSessionTitle(): Promise<string>;

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

  /** Apply a per-model context limit; refreshes the context meter when known. */
  setMaxContextTokens(tokens: number): void;

  /**
   * Escape hatch for advanced hosts. Prefer not to use from ordinary UI code.
   */
  readonly advanced: {
    runtime: Runtime;
  };
}
