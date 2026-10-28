import { emptyDocument } from "./parse.js";
import type {
  FlagOverrides,
  MinConfigDocument,
  ResolvedMinConfig,
  RuntimeConfig,
  ThemeOverrideConfig,
  UiConfig,
} from "./types.js";
import { CONFIG_VERSION } from "./types.js";

/** Deep-merge sparse documents. Later layers win on scalars; objects merge. */
export function mergeDocuments(
  ...layers: readonly MinConfigDocument[]
): MinConfigDocument {
  let out = emptyDocument();
  for (const layer of layers) out = mergeTwo(out, layer);
  return out;
}

export function toResolved(
  document: MinConfigDocument,
  sources: readonly string[],
): ResolvedMinConfig {
  return {
    version: CONFIG_VERSION,
    ...(document.provider ? { provider: document.provider } : {}),
    ...(document.model ? { model: document.model } : {}),
    runtime: { ...(document.runtime ?? {}) },
    ui: {
      ...(document.ui?.theme ? { theme: document.ui.theme } : {}),
      ...(document.ui?.themeOverrides
        ? { themeOverrides: { ...document.ui.themeOverrides } }
        : {}),
    },
    extensions: { ...(document.extensions ?? {}) },
    sources: [...sources],
  };
}

/** Apply CLI / host flag overrides on top of a resolved config. */
export function applyFlagOverrides(
  config: ResolvedMinConfig,
  flags: FlagOverrides,
): ResolvedMinConfig {
  const runtime: RuntimeConfig = { ...config.runtime };
  if (flags.maxTurns !== undefined) runtime.maxTurns = flags.maxTurns;
  if (flags.maxContextTokens !== undefined) {
    runtime.maxContextTokens = flags.maxContextTokens;
  }
  if (flags.contextStrategy !== undefined) {
    runtime.contextStrategy = flags.contextStrategy;
  }
  if (flags.sessionDir !== undefined) runtime.sessionDir = flags.sessionDir;

  const ui: UiConfig = { ...config.ui };
  if (flags.theme !== undefined) ui.theme = flags.theme;

  return {
    ...config,
    ...(flags.provider !== undefined ? { provider: flags.provider } : {}),
    ...(flags.model !== undefined ? { model: flags.model } : {}),
    runtime,
    ui,
    sources: flagsHaveValues(flags) ? [...config.sources, "flags"] : config.sources,
  };
}

/** Map `MIN_*` env into a sparse document layer. */
export function documentFromEnv(env: NodeJS.ProcessEnv): MinConfigDocument {
  const runtime: RuntimeConfig = {};
  const maxTurns = readInt(env.MIN_MAX_TURNS);
  const maxContextTokens = readInt(env.MIN_MAX_CONTEXT_TOKENS);
  if (maxTurns !== undefined) runtime.maxTurns = maxTurns;
  if (maxContextTokens !== undefined) runtime.maxContextTokens = maxContextTokens;
  if (env.MIN_CONTEXT_STRATEGY?.trim()) {
    runtime.contextStrategy = env.MIN_CONTEXT_STRATEGY.trim();
  }

  const ui: UiConfig = {};
  if (env.MIN_THEME?.trim()) ui.theme = env.MIN_THEME.trim();

  return {
    version: CONFIG_VERSION,
    ...(env.MIN_PROVIDER?.trim() ? { provider: env.MIN_PROVIDER.trim() } : {}),
    ...(env.MIN_MODEL?.trim() ? { model: env.MIN_MODEL.trim() } : {}),
    ...(Object.keys(runtime).length > 0 ? { runtime } : {}),
    ...(Object.keys(ui).length > 0 ? { ui } : {}),
  };
}

function mergeTwo(base: MinConfigDocument, overlay: MinConfigDocument): MinConfigDocument {
  return {
    version: CONFIG_VERSION,
    provider: overlay.provider ?? base.provider,
    model: overlay.model ?? base.model,
    runtime: mergeRuntime(base.runtime, overlay.runtime),
    ui: mergeUi(base.ui, overlay.ui),
    extensions: { ...(base.extensions ?? {}), ...(overlay.extensions ?? {}) },
  };
}

function mergeRuntime(
  base?: RuntimeConfig,
  overlay?: RuntimeConfig,
): RuntimeConfig | undefined {
  if (!base && !overlay) return undefined;
  return { ...(base ?? {}), ...(overlay ?? {}) };
}

function mergeUi(base?: UiConfig, overlay?: UiConfig): UiConfig | undefined {
  if (!base && !overlay) return undefined;
  const theme = overlay?.theme ?? base?.theme;
  const themeOverrides = mergeThemeOverrides(base?.themeOverrides, overlay?.themeOverrides);
  const keybindings =
    base?.keybindings || overlay?.keybindings
      ? { ...(base?.keybindings ?? {}), ...(overlay?.keybindings ?? {}) }
      : undefined;
  const out: UiConfig = {};
  if (theme) out.theme = theme;
  if (themeOverrides) out.themeOverrides = themeOverrides;
  if (keybindings && Object.keys(keybindings).length > 0) out.keybindings = keybindings;
  return Object.keys(out).length > 0 ? out : undefined;
}

function mergeThemeOverrides(
  base?: ThemeOverrideConfig,
  overlay?: ThemeOverrideConfig,
): ThemeOverrideConfig | undefined {
  if (!base && !overlay) return undefined;
  if (!base) return overlay ? { ...overlay } : undefined;
  if (!overlay) return { ...base };
  return {
    id: overlay.id ?? base.id,
    name: overlay.name ?? base.name,
    roles: deepStringRecords(base.roles, overlay.roles),
    frames: { ...(base.frames ?? {}), ...(overlay.frames ?? {}) },
    activity: { ...(base.activity ?? {}), ...(overlay.activity ?? {}) },
    chrome: { ...(base.chrome ?? {}), ...(overlay.chrome ?? {}) },
  };
}

function deepStringRecords(
  base?: Record<string, Record<string, unknown>>,
  overlay?: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> | undefined {
  if (!base && !overlay) return undefined;
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(overlay ?? {})]);
  const out: Record<string, Record<string, unknown>> = {};
  for (const key of keys) {
    out[key] = { ...(base?.[key] ?? {}), ...(overlay?.[key] ?? {}) };
  }
  return out;
}

function readInt(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

function flagsHaveValues(flags: FlagOverrides): boolean {
  return Object.values(flags).some((value) => value !== undefined);
}
