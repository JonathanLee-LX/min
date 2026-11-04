import type { ReasoningEffort } from "@min-agent/core";

/**
 * min configuration document.
 *
 * Design goals:
 * - Sparse files: omit what you do not override.
 * - Forward compatible: unknown keys land in `extensions`.
 * - Layered like Command Code: user files, committed project settings,
 *   machine-local project state, then env, then flags.
 * - Stable sidecars: the grant ledger and sessions stay outside these files.
 */

export const CONFIG_VERSION = 1 as const;

export type ConfigVersion = typeof CONFIG_VERSION;

export interface RuntimeConfig {
  maxTurns?: number;
  maxContextTokens?: number;
  /** trim | hmt | tool-offload | sticky-trim | hybrid */
  contextStrategy?: string;
  /** Absolute or cwd-relative session store. */
  sessionDir?: string;
}

/**
 * Theme tokens as plain JSON. Hosts map this onto their theme type
 * (e.g. TUI `createTheme`). Shape is intentionally loose.
 */
export interface ThemeOverrideConfig {
  id?: string;
  name?: string;
  roles?: Record<string, Record<string, unknown>>;
  frames?: Record<string, unknown>;
  activity?: Record<string, unknown>;
  chrome?: Record<string, unknown>;
  markdown?: Record<string, unknown>;
}

export interface UiConfig {
  /** Registered theme id, or a local override id. */
  theme?: string;
  themeOverrides?: ThemeOverrideConfig;
  /**
   * Sparse chord → command overrides for the TUI composer.
   * Hosts merge these onto built-in defaults (Enter=submit, Shift+Enter=newline).
   * Chords are case-insensitive (`shift+enter`); unknown commands are ignored.
   */
  keybindings?: Record<string, string>;
}

/**
 * One sparse config document (file contents or a merge layer).
 * All fields except a present `version` are optional.
 */
export interface MinConfigDocument {
  version: ConfigVersion;
  provider?: string;
  model?: string;
  /**
   * Thinking intensity: `none`, `low`, `medium`, `high`, or `max`.
   * Omit it to keep the provider default. DeepSeek responses defaults to `high`.
   */
  reasoningEffort?: ReasoningEffort;
  runtime?: RuntimeConfig;
  ui?: UiConfig;
  /**
   * Unknown or plugin-owned keys. Older min ignores them; newer hosts
   * may read named entries without a schema bump.
   */
  extensions?: Record<string, unknown>;
}

export type PermissionModeName = "allow" | "ask" | "deny";

/** `settings.json`: hooks, permission policy, MCP enablement. */
export interface MinSettings {
  permissions?: {
    read?: PermissionModeName;
    write?: PermissionModeName;
    bash?: PermissionModeName;
  };
  hooks?: Record<string, unknown>;
  mcp?: { enabled?: boolean };
  extensions?: Record<string, unknown>;
}

/** `auth.json`: secret values keyed by environment variable name. */
export interface AuthDocument {
  version: ConfigVersion;
  keys: Record<string, string>;
}

/** One entry in `providers.json`. The key lives in `auth.json` or the environment. */
export interface ProviderSpec {
  kind: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
}

/** One MCP server after `mcp.json` / `.mcp.json` files are merged by name. */
export interface McpServerEntry {
  name: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

/** One managed row in `cron/jobs.json`. */
export interface CronJob {
  id: string;
  schedule?: string;
  prompt?: string;
  enabled?: boolean;
}

/** Fully resolved view after all layers. */
export interface ResolvedMinConfig {
  version: ConfigVersion;
  provider?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  runtime: RuntimeConfig;
  ui: UiConfig;
  settings: MinSettings;
  /** Credential map from `auth.json`. Values are secrets. */
  auth: Record<string, string>;
  providers: Record<string, ProviderSpec>;
  mcpServers: McpServerEntry[];
  cronJobs: CronJob[];
  extensions: Record<string, unknown>;
  /** Paths that contributed, lowest first. */
  sources: string[];
}

export interface LoadMinConfigOptions {
  cwd: string;
  /** Home directory used for `~/.min`. Tests pass a temp directory. */
  home?: string;
  /**
   * Replace the user preference file. When set, the user home tree
   * (`~/.min/*`) is not scanned.
   */
  userPath?: string;
  /** Extra project preference file, read in the legacy project-config slot. */
  projectPath?: string;
  env?: NodeJS.ProcessEnv;
  /** Skip reading the filesystem (defaults + env + flags only). */
  skipFiles?: boolean;
}

export interface FlagOverrides {
  provider?: string;
  model?: string;
  theme?: string;
  maxTurns?: number;
  maxContextTokens?: number;
  contextStrategy?: string;
  sessionDir?: string;
}
