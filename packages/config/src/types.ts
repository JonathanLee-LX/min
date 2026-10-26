/**
 * min configuration document.
 *
 * Design goals:
 * - Sparse files: omit what you do not override.
 * - Forward compatible: unknown keys land in `extensions`.
 * - Layered: defaults < user < project < env < flags.
 * - Stable sidecars: permissions and sessions stay outside this file.
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
}

export interface UiConfig {
  /** Registered theme id, or a local override id. */
  theme?: string;
  themeOverrides?: ThemeOverrideConfig;
}

/**
 * One sparse config document (file contents or a merge layer).
 * All fields except a present `version` are optional.
 */
export interface MinConfigDocument {
  version: ConfigVersion;
  provider?: string;
  model?: string;
  runtime?: RuntimeConfig;
  ui?: UiConfig;
  /**
   * Unknown or plugin-owned keys. Older min ignores them; newer hosts
   * may read named entries without a schema bump.
   */
  extensions?: Record<string, unknown>;
}

/** Fully resolved view after all layers. */
export interface ResolvedMinConfig {
  version: ConfigVersion;
  provider?: string;
  model?: string;
  runtime: RuntimeConfig;
  ui: UiConfig;
  extensions: Record<string, unknown>;
  /** Paths that contributed, lowest first. */
  sources: string[];
}

export interface LoadMinConfigOptions {
  cwd: string;
  /** Override user config path (tests). */
  userPath?: string;
  /** Override project config path (tests). */
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
