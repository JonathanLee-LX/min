import {
  CONFIG_VERSION,
  type MinConfigDocument,
  type RuntimeConfig,
  type ThemeOverrideConfig,
  type UiConfig,
} from "./types.js";

export interface ParseResult {
  document: MinConfigDocument;
  /** Keys that were not part of v1 and were moved under extensions. */
  unknownKeys: string[];
  /** Non-fatal notes (e.g. future version). */
  warnings: string[];
}

const KNOWN_TOP = new Set([
  "version",
  "provider",
  "model",
  "runtime",
  "ui",
  "extensions",
]);

/**
 * Parse a JSON value into a sparse document.
 * Never throws on unknown keys — they become `extensions` entries.
 */
export function parseConfigDocument(value: unknown): ParseResult {
  const warnings: string[] = [];
  const unknownKeys: string[] = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      document: emptyDocument(),
      unknownKeys,
      warnings: ["config root must be an object; using empty document"],
    };
  }

  const raw = value as Record<string, unknown>;
  const version = readVersion(raw.version, warnings);
  const extensions: Record<string, unknown> = {};

  if (raw.extensions && typeof raw.extensions === "object" && !Array.isArray(raw.extensions)) {
    Object.assign(extensions, raw.extensions as Record<string, unknown>);
  }

  for (const key of Object.keys(raw)) {
    if (KNOWN_TOP.has(key)) continue;
    unknownKeys.push(key);
    if (!(key in extensions)) extensions[key] = raw[key];
  }

  const document: MinConfigDocument = {
    version,
    ...(typeof raw.provider === "string" && raw.provider.trim()
      ? { provider: raw.provider.trim() }
      : {}),
    ...(typeof raw.model === "string" && raw.model.trim()
      ? { model: raw.model.trim() }
      : {}),
    ...(parseRuntime(raw.runtime)
      ? { runtime: parseRuntime(raw.runtime) }
      : {}),
    ...(parseUi(raw.ui) ? { ui: parseUi(raw.ui) } : {}),
    ...(Object.keys(extensions).length > 0 ? { extensions } : {}),
  };

  return { document, unknownKeys, warnings };
}

export function emptyDocument(): MinConfigDocument {
  return { version: CONFIG_VERSION };
}

export function defaultResolved(): import("./types.js").ResolvedMinConfig {
  return {
    version: CONFIG_VERSION,
    runtime: {},
    ui: {},
    extensions: {},
    sources: ["defaults"],
  };
}

function readVersion(value: unknown, warnings: string[]): typeof CONFIG_VERSION {
  if (value === undefined || value === null) {
    warnings.push("missing version; treating as 1");
    return CONFIG_VERSION;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
    if (value > CONFIG_VERSION) {
      warnings.push(
        `config version ${value} is newer than supported ${CONFIG_VERSION}; loading known fields only`,
      );
    }
    return CONFIG_VERSION;
  }
  warnings.push("invalid version; treating as 1");
  return CONFIG_VERSION;
}

function parseRuntime(value: unknown): RuntimeConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: RuntimeConfig = {};
  if (isPositiveInt(raw.maxTurns)) out.maxTurns = raw.maxTurns;
  if (isPositiveInt(raw.maxContextTokens)) out.maxContextTokens = raw.maxContextTokens;
  if (typeof raw.contextStrategy === "string" && raw.contextStrategy.trim()) {
    out.contextStrategy = raw.contextStrategy.trim();
  }
  if (typeof raw.sessionDir === "string" && raw.sessionDir.trim()) {
    out.sessionDir = raw.sessionDir.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseUi(value: unknown): UiConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: UiConfig = {};
  if (typeof raw.theme === "string" && raw.theme.trim()) out.theme = raw.theme.trim();
  const overrides = parseThemeOverrides(raw.themeOverrides);
  if (overrides) out.themeOverrides = overrides;
  const keybindings = parseKeybindings(raw.keybindings);
  if (keybindings) out.keybindings = keybindings;
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseKeybindings(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [chord, command] of Object.entries(value as Record<string, unknown>)) {
    if (typeof chord !== "string" || !chord.trim()) continue;
    if (typeof command !== "string") continue;
    out[chord.trim()] = command.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseThemeOverrides(value: unknown): ThemeOverrideConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: ThemeOverrideConfig = {};
  if (typeof raw.id === "string" && raw.id.trim()) out.id = raw.id.trim();
  if (typeof raw.name === "string" && raw.name.trim()) out.name = raw.name.trim();
  if (isPlainObject(raw.roles)) out.roles = raw.roles as ThemeOverrideConfig["roles"];
  if (isPlainObject(raw.frames)) out.frames = raw.frames as ThemeOverrideConfig["frames"];
  if (isPlainObject(raw.activity)) out.activity = raw.activity as ThemeOverrideConfig["activity"];
  if (isPlainObject(raw.chrome)) out.chrome = raw.chrome as ThemeOverrideConfig["chrome"];
  if (isPlainObject(raw.markdown)) out.markdown = raw.markdown as ThemeOverrideConfig["markdown"];
  return Object.keys(out).length > 0 ? out : undefined;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
