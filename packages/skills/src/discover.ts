import { accessSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface DiscoverSkillDirsOptions {
  cwd: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Skill directories, lowest first. Later dirs overwrite a skill of the same name.
 * Claude Code, Codex, and Cursor load before min so min wins.
 */
export function skillDirCandidates(opts: DiscoverSkillDirsOptions): string[] {
  const cwd = path.resolve(opts.cwd);
  const home = opts.home ?? os.homedir();
  const env = opts.env ?? process.env;
  const claude = envDir(env.CLAUDE_CONFIG_DIR, path.join(home, ".claude"));
  const codex = envDir(env.CODEX_HOME, path.join(home, ".codex"));
  const cursor = envDir(env.CURSOR_CONFIG_DIR, path.join(home, ".cursor"));
  return uniqueDirs([
    path.join(home, ".agents", "skills"),
    path.join(codex, "skills"),
    path.join(claude, "skills"),
    path.join(cursor, "skills"),
    path.join(cwd, ".agents", "skills"),
    path.join(cwd, ".codex", "skills"),
    path.join(cwd, ".claude", "skills"),
    path.join(cwd, ".cursor", "skills"),
    path.join(home, ".min", "skills"),
    path.join(cwd, ".min", "skills"),
    path.join(cwd, "skills"),
  ]);
}

/** Existing skill directories from `skillDirCandidates`, still lowest first. */
export function discoverSkillDirs(opts: DiscoverSkillDirsOptions): string[] {
  return skillDirCandidates(opts).filter(exists);
}

function envDir(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  return value ? path.resolve(value) : fallback;
}

function uniqueDirs(dirs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function exists(dir: string): boolean {
  try {
    accessSync(dir);
    return true;
  } catch {
    return false;
  }
}
