export { CONFIG_VERSION } from "./types.js";
export type {
  ConfigVersion,
  FlagOverrides,
  LoadMinConfigOptions,
  MinConfigDocument,
  ResolvedMinConfig,
  RuntimeConfig,
  ThemeOverrideConfig,
  UiConfig,
} from "./types.js";

export {
  defaultSessionDir,
  permissionRulesPath,
  projectConfigPath,
  userConfigPath,
} from "./paths.js";

export { emptyDocument, parseConfigDocument } from "./parse.js";
export type { ParseResult } from "./parse.js";

export {
  applyFlagOverrides,
  documentFromEnv,
  mergeDocuments,
  toResolved,
} from "./merge.js";

export { loadMinConfig, resolveMinConfig } from "./load.js";
export type { LoadMinConfigResult } from "./load.js";
