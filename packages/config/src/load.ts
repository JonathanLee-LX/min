import { readFileSync } from "node:fs";
import {
  applyFlagOverrides,
  documentFromEnv,
  mergeDocuments,
  toResolved,
} from "./merge.js";
import { emptyDocument, parseConfigDocument } from "./parse.js";
import { projectConfigPath, userConfigPath } from "./paths.js";
import type {
  FlagOverrides,
  LoadMinConfigOptions,
  MinConfigDocument,
  ResolvedMinConfig,
} from "./types.js";

export interface LoadMinConfigResult {
  config: ResolvedMinConfig;
  warnings: string[];
}

/**
 * Load and merge config layers.
 * Does not throw on missing or partial files.
 */
export function loadMinConfig(opts: LoadMinConfigOptions): LoadMinConfigResult {
  const env = opts.env ?? process.env;
  const warnings: string[] = [];
  const layers: MinConfigDocument[] = [emptyDocument()];
  const sources: string[] = ["defaults"];

  if (!opts.skipFiles) {
    const userPath = opts.userPath ?? userConfigPath();
    const user = readConfigFile(userPath, warnings);
    if (user) {
      layers.push(user);
      sources.push(userPath);
    }

    const projectPath = opts.projectPath ?? projectConfigPath(opts.cwd);
    const project = readConfigFile(projectPath, warnings);
    if (project) {
      layers.push(project);
      sources.push(projectPath);
    }
  }

  const fromEnv = documentFromEnv(env);
  if (layerHasValues(fromEnv)) {
    layers.push(fromEnv);
    sources.push("env");
  }

  const merged = mergeDocuments(...layers);
  return { config: toResolved(merged, sources), warnings };
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

function readConfigFile(
  file: string,
  warnings: string[],
): MinConfigDocument | undefined {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  if (!raw.trim()) return undefined;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    warnings.push(
      `ignored invalid JSON in ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  const parsed = parseConfigDocument(json);
  for (const warning of parsed.warnings) {
    warnings.push(`${file}: ${warning}`);
  }
  for (const key of parsed.unknownKeys) {
    warnings.push(`${file}: unknown key "${key}" kept under extensions`);
  }
  return parsed.document;
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
