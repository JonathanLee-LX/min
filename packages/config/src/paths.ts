import os from "node:os";
import path from "node:path";

/** User-global preferences. */
export function userConfigPath(home = os.homedir()): string {
  return path.join(home, ".config", "min", "config.json");
}

/** Project-local preferences under the sandbox cwd. */
export function projectConfigPath(cwd: string): string {
  return path.join(cwd, ".min", "config.json");
}

/** Existing grant ledger — not part of config.json. */
export function permissionRulesPath(cwd: string): string {
  return path.join(cwd, ".min", "permissions.json");
}

/** Session store default — not part of config.json. */
export function defaultSessionDir(cwd: string): string {
  return path.join(cwd, ".min", "sessions");
}
