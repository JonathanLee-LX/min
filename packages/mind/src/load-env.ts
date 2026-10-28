import { readFileSync } from "node:fs";
import path from "node:path";

/** Load KEY=VALUE pairs from .env files into process.env (does not override). */
export function loadEnvFiles(cwd = process.cwd()): void {
  const files: string[] = [];
  if (process.env.HOME) {
    files.push(path.join(process.env.HOME, ".config", "min", ".env"));
  }
  let dir = path.resolve(cwd);
  for (let i = 0; i < 5; i++) {
    files.push(path.join(dir, ".env"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    applyEnvFile(file);
  }
}

function applyEnvFile(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
