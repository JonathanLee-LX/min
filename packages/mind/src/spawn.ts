import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export function spawnNode(
  entry: string,
  args: string[],
  opts: SpawnOptions,
) {
  const nodeArgs =
    entry.endsWith(".ts") || entry.endsWith(".tsx")
      ? ["--import", tsxLoader(), entry, ...args]
      : [entry, ...args];
  return spawn(process.execPath, nodeArgs, { ...opts, shell: false });
}

function tsxLoader(): string {
  const pkg = require.resolve("tsx/package.json");
  const esm = join(dirname(pkg), "dist/esm/index.mjs");
  if (!existsSync(esm)) {
    throw new Error(`tsx loader not found at ${esm}`);
  }
  return esm;
}
