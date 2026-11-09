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

export {
  claudeJsonPath,
  claudeProjectSettingsLocalPath,
  claudeProjectSettingsPath,
  claudeUserSettingsPath,
  claudeConfigDir,
  codexHomeDir,
  codexProjectConfigPath,
  codexUserConfigPath,
  cursorConfigDir,
  cursorProjectCliConfigPath,
  cursorProjectMcpPath,
  cursorUserCliConfigPath,
  cursorUserMcpPath,
} from "./compat-paths.js";

export { inferProviderKind, loadCompatLayers, mergeAuth, mergeProviders } from "./compat.js";
export type { CompatLayer, LoadCompatOptions } from "./compat.js";
export { providerLaunchSpec } from "./launch.js";
export type { ProviderLaunchSpec } from "./launch.js";
export { parseToml } from "./toml.js";

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

export {
  DEFAULT_MODEL_CONTEXT_TOKENS,
  effectiveMaxContextTokens,
  modelIdFromProviderId,
} from "./model-context.js";
