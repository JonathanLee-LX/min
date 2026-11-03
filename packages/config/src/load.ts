import { readFileSync } from "node:fs";
import os from "node:os";
import {
  applyFlagOverrides,
  documentFromEnv,
  mergeDocuments,
  toResolved,
} from "./merge.js";
import { emptyDocument, parseConfigDocument } from "./parse.js";
import {
  keybindingDocument,
  parseAuthFile,
  parseCronFile,
  parseKeybindingFile,
  parseMcpFile,
  parseProvidersFile,
  parseSettingsFile,
} from "./files.js";
import {
  legacyProjectConfigPath,
  legacyUserConfigPath,
  projectMcpPath,
  projectSettingsLocalPath,
  projectSettingsPath,
  userAuthPath,
  userConfigPath,
  userCronJobsPath,
  userKeybindingsPath,
  userMcpPath,
  userProjectConfigPath,
  userProjectMcpPath,
  userProvidersPath,
  userSettingsPath,
} from "./paths.js";
import type {
  CronJob,
  FlagOverrides,
  LoadMinConfigOptions,
  McpServerEntry,
  MinConfigDocument,
  MinSettings,
  ProviderSpec,
  ResolvedMinConfig,
} from "./types.js";

export interface LoadMinConfigResult {
  config: ResolvedMinConfig;
  warnings: string[];
}

/**
 * Load and merge config layers.
 * Does not throw on missing or partial files.
 *
 * Low → high:
 * defaults, legacy user config, ~/.min/config.json, keybindings,
 * ~/.min/settings.json, providers, user mcp, legacy project config,
 * <cwd>/.min/settings.json, <cwd>/.mcp.json, per-project state,
 * per-project mcp, <cwd>/.min/settings.local.json, env.
 * `auth.json` and `cron/jobs.json` are attached, not merged into preferences.
 */
export function loadMinConfig(opts: LoadMinConfigOptions): LoadMinConfigResult {
  const env = opts.env ?? process.env;
  const warnings: string[] = [];
  const sources: string[] = ["defaults"];
  let document = emptyDocument();
  let settings: MinSettings = {};
  let auth: Record<string, string> = {};
  let providers: Record<string, ProviderSpec> = {};
  let mcpServers: McpServerEntry[] = [];
  let cronJobs: CronJob[] = [];

  if (!opts.skipFiles) {
    const home = opts.home ?? os.homedir();
    const cwd = opts.cwd;
    const isolatedUser = opts.userPath !== undefined;

    const takeConfig = (file: string) => {
      const parsed = readConfigFile(file, warnings);
      if (!parsed) return;
      document = mergeDocuments(document, parsed);
      sources.push(file);
    };
    const takeSettings = (file: string) => {
      const parsed = readTypedFile(file, parseSettingsFile, warnings);
      if (!parsed) return;
      settings = mergeSettings(settings, parsed);
      sources.push(file);
    };
    const takeMcp = (file: string) => {
      const parsed = readTypedFile(file, parseMcpFile, warnings);
      if (!parsed) return;
      mcpServers = mergeMcp(mcpServers, parsed);
      sources.push(file);
    };

    if (isolatedUser) {
      takeConfig(opts.userPath!);
    } else {
      takeConfig(legacyUserConfigPath(home));
      takeConfig(userConfigPath(home));
      const bindings = readTypedFile(userKeybindingsPath(home), parseKeybindingFile, warnings);
      if (bindings && Object.keys(bindings).length > 0) {
        const layer = keybindingDocument(bindings);
        if (layer) document = mergeDocuments(document, layer);
        sources.push(userKeybindingsPath(home));
      }
      takeSettings(userSettingsPath(home));
      const providerFile = readTypedFile(userProvidersPath(home), parseProvidersFile, warnings);
      if (providerFile && Object.keys(providerFile).length > 0) {
        providers = providerFile;
        sources.push(userProvidersPath(home));
      }
      const authFile = readTypedFile(userAuthPath(home), parseAuthFile, warnings);
      if (authFile && Object.keys(authFile.keys).length > 0) {
        auth = authFile.keys;
        sources.push(userAuthPath(home));
      }
      const jobs = readTypedFile(userCronJobsPath(home), parseCronFile, warnings);
      if (jobs && jobs.length > 0) {
        cronJobs = jobs;
        sources.push(userCronJobsPath(home));
      }
      takeMcp(userMcpPath(home));
    }

    takeConfig(opts.projectPath ?? legacyProjectConfigPath(cwd));
    takeSettings(projectSettingsPath(cwd));
    takeMcp(projectMcpPath(cwd));
    if (!opts.projectPath) takeConfig(userProjectConfigPath(cwd, home));
    if (!isolatedUser) takeMcp(userProjectMcpPath(cwd, home));
    takeSettings(projectSettingsLocalPath(cwd));
  }

  const fromEnv = documentFromEnv(env);
  if (layerHasValues(fromEnv)) {
    document = mergeDocuments(document, fromEnv);
    sources.push("env");
  }

  const config = toResolved(document, sources);
  config.settings = settings;
  config.auth = auth;
  config.providers = providers;
  config.mcpServers = mcpServers;
  config.cronJobs = cronJobs;
  return { config, warnings };
}

/** Convenience: load files/env, then apply host flags. */
export function resolveMinConfig(
  opts: LoadMinConfigOptions,
  flags: FlagOverrides = {},
): LoadMinConfigResult {
  const loaded = loadMinConfig(opts);
  return {
    config: applyFlagOverrides(loaded.config, flags),
    warnings: loaded.warnings,
  };
}

/**
 * Copy `auth.json` keys into the environment when the variable is unset.
 * Existing process and `.env` values win.
 */
export function applyAuthToEnv(
  auth: Readonly<Record<string, string>>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const [key, value] of Object.entries(auth)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (env[key] === undefined) env[key] = value;
  }
}

function mergeSettings(base: MinSettings, overlay: MinSettings): MinSettings {
  const permissions = { ...(base.permissions ?? {}), ...(overlay.permissions ?? {}) };
  const hooks = { ...(base.hooks ?? {}), ...(overlay.hooks ?? {}) };
  const mcp = { ...(base.mcp ?? {}), ...(overlay.mcp ?? {}) };
  const extensions = { ...(base.extensions ?? {}), ...(overlay.extensions ?? {}) };
  const out: MinSettings = {};
  if (Object.keys(permissions).length > 0) out.permissions = permissions;
  if (Object.keys(hooks).length > 0) out.hooks = hooks;
  if (Object.keys(mcp).length > 0) out.mcp = mcp;
  if (Object.keys(extensions).length > 0) out.extensions = extensions;
  return out;
}

function mergeMcp(base: readonly McpServerEntry[], overlay: readonly McpServerEntry[]): McpServerEntry[] {
  const byName = new Map(base.map((server) => [server.name, server]));
  for (const server of overlay) byName.set(server.name, server);
  return [...byName.values()];
}

function readConfigFile(file: string, warnings: string[]): MinConfigDocument | undefined {
  const json = readJson(file, warnings);
  if (!json) return undefined;
  const parsed = parseConfigDocument(json);
  for (const warning of parsed.warnings) warnings.push(`${file}: ${warning}`);
  for (const key of parsed.unknownKeys) {
    warnings.push(`${file}: unknown key "${key}" kept under extensions`);
  }
  return parsed.document;
}

function readTypedFile<T>(
  file: string,
  parse: (value: unknown) => { value: T; warnings: string[] },
  warnings: string[],
): T | undefined {
  const json = readJson(file, warnings);
  if (!json) return undefined;
  const parsed = parse(json);
  for (const warning of parsed.warnings) warnings.push(`${file}: ${warning}`);
  return parsed.value;
}

function readJson(file: string, warnings: string[]): unknown | undefined {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    warnings.push(
      `ignored invalid JSON in ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

function layerHasValues(doc: MinConfigDocument): boolean {
  return !!(
    doc.provider ||
    doc.model ||
    (doc.runtime && Object.keys(doc.runtime).length > 0) ||
    (doc.ui && Object.keys(doc.ui).length > 0) ||
    (doc.extensions && Object.keys(doc.extensions).length > 0)
  );
}
