import os from "node:os";
import path from "node:path";

/**
 * User-global min directory, analogous to Command Code's `~/.commandcode/`.
 *
 * ```
 * ~/.min/config.json
 * ~/.min/settings.json
 * ~/.min/auth.json
 * ~/.min/providers.json
 * ~/.min/keybindings.json
 * ~/.min/mcp.json
 * ~/.min/cron/jobs.json
 * ~/.min/projects/{project}/config.json
 * ~/.min/projects/{project}/mcp.json
 * ```
 */
export function userMinDir(home = os.homedir()): string {
  return path.join(home, ".min");
}

/** User preferences: provider, model, runtime, theme. */
export function userConfigPath(home = os.homedir()): string {
  return path.join(userMinDir(home), "config.json");
}

/** User hooks, permission policy, and MCP enablement. */
export function userSettingsPath(home = os.homedir()): string {
  return path.join(userMinDir(home), "settings.json");
}

/** Credentials written by the host. Not a hand-edited preferences file. */
export function userAuthPath(home = os.homedir()): string {
  return path.join(userMinDir(home), "auth.json");
}

/** Custom bring-your-own-key provider entries. */
export function userProvidersPath(home = os.homedir()): string {
  return path.join(userMinDir(home), "providers.json");
}

/** Chord → command overrides. */
export function userKeybindingsPath(home = os.homedir()): string {
  return path.join(userMinDir(home), "keybindings.json");
}

/** User-scope MCP servers. */
export function userMcpPath(home = os.homedir()): string {
  return path.join(userMinDir(home), "mcp.json");
}

/** Managed scheduled jobs. */
export function userCronJobsPath(home = os.homedir()): string {
  return path.join(userMinDir(home), "cron", "jobs.json");
}

/**
 * Stable directory slug for a project cwd.
 * `/work/app` → `work--app`.
 */
export function projectId(cwd: string): string {
  const abs = path.resolve(cwd);
  const slug = abs
    .replace(/^[A-Za-z]:/, (drive) => drive.slice(0, 1).toLowerCase())
    .split(/[/\\]+/)
    .filter(Boolean)
    .join("--")
    .replace(/[^A-Za-z0-9._-]+/g, "-");
  return slug || "project";
}

export function userProjectDir(cwd: string, home = os.homedir()): string {
  return path.join(userMinDir(home), "projects", projectId(cwd));
}

/** Per-project state on this machine (theme, model, last overrides). */
export function userProjectConfigPath(cwd: string, home = os.homedir()): string {
  return path.join(userProjectDir(cwd, home), "config.json");
}

/** Per-project MCP servers on this machine. */
export function userProjectMcpPath(cwd: string, home = os.homedir()): string {
  return path.join(userProjectDir(cwd, home), "mcp.json");
}

/** Shared project settings. Commit this. */
export function projectSettingsPath(cwd: string): string {
  return path.join(cwd, ".min", "settings.json");
}

/** Machine-local project overrides. Gitignore this. */
export function projectSettingsLocalPath(cwd: string): string {
  return path.join(cwd, ".min", "settings.local.json");
}

/** Shared MCP servers. Commit this. */
export function projectMcpPath(cwd: string): string {
  return path.join(cwd, ".mcp.json");
}

/** Previous user preferences path. Still read, below `~/.min/config.json`. */
export function legacyUserConfigPath(home = os.homedir()): string {
  return path.join(home, ".config", "min", "config.json");
}

/** Previous project preferences path. Still read, below user config. */
export function legacyProjectConfigPath(cwd: string): string {
  return path.join(cwd, ".min", "config.json");
}

/** Existing grant ledger — not part of settings.json. */
export function permissionRulesPath(cwd: string): string {
  return path.join(cwd, ".min", "permissions.json");
}

/** Session store default — not part of config.json. */
export function defaultSessionDir(cwd: string): string {
  return path.join(cwd, ".min", "sessions");
}
