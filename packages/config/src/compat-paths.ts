import os from "node:os";
import path from "node:path";

export function claudeConfigDir(home = os.homedir(), env: NodeJS.ProcessEnv = process.env): string {
  return envDir(env.CLAUDE_CONFIG_DIR, path.join(home, ".claude"));
}

export function claudeJsonPath(home = os.homedir()): string {
  return path.join(home, ".claude.json");
}

export function claudeUserSettingsPath(
  home = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(claudeConfigDir(home, env), "settings.json");
}

export function claudeProjectSettingsPath(cwd: string): string {
  return path.join(cwd, ".claude", "settings.json");
}

export function claudeProjectSettingsLocalPath(cwd: string): string {
  return path.join(cwd, ".claude", "settings.local.json");
}

export function codexHomeDir(home = os.homedir(), env: NodeJS.ProcessEnv = process.env): string {
  return envDir(env.CODEX_HOME, path.join(home, ".codex"));
}

export function codexUserConfigPath(
  home = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(codexHomeDir(home, env), "config.toml");
}

export function codexProjectConfigPath(cwd: string): string {
  return path.join(cwd, ".codex", "config.toml");
}

export function cursorConfigDir(home = os.homedir(), env: NodeJS.ProcessEnv = process.env): string {
  return envDir(env.CURSOR_CONFIG_DIR, path.join(home, ".cursor"));
}

export function cursorUserMcpPath(
  home = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(cursorConfigDir(home, env), "mcp.json");
}

export function cursorUserCliConfigPath(
  home = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(cursorConfigDir(home, env), "cli-config.json");
}

export function cursorProjectMcpPath(cwd: string): string {
  return path.join(cwd, ".cursor", "mcp.json");
}

export function cursorProjectCliConfigPath(cwd: string): string {
  return path.join(cwd, ".cursor", "cli.json");
}

function envDir(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  return value ? path.resolve(value) : fallback;
}
