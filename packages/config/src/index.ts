export { CONFIG_VERSION } from "./types.js";
export type {
  AuthDocument,
  ConfigVersion,
  CronJob,
  FlagOverrides,
  LoadMinConfigOptions,
  McpServerEntry,
  MinConfigDocument,
  MinSettings,
  PermissionModeName,
  ProviderSpec,
  ResolvedMinConfig,
  RuntimeConfig,
  ThemeOverrideConfig,
  UiConfig,
} from "./types.js";

export {
  defaultSessionDir,
  legacyProjectConfigPath,
  legacyUserConfigPath,
  permissionRulesPath,
  projectId,
  projectMcpPath,
  projectSettingsLocalPath,
  projectSettingsPath,
  userAuthPath,
  userConfigPath,
  userCronJobsPath,
  userKeybindingsPath,
  userMcpPath,
  userMinDir,
  userProjectConfigPath,
  userProjectDir,
  userProjectMcpPath,
  userProvidersPath,
  userSettingsPath,
} from "./paths.js";

export { emptyDocument, parseConfigDocument } from "./parse.js";
export type { ParseResult } from "./parse.js";

export {
  applyFlagOverrides,
  documentFromEnv,
  mergeDocuments,
  toResolved,
} from "./merge.js";

export { applyAuthToEnv, legacyConfigNotice, loadMinConfig, resolveMinConfig } from "./load.js";
export type { LoadMinConfigResult } from "./load.js";
