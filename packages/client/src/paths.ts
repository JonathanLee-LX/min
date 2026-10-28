import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Entry mind spawns for one session. Source path under tests, dist path when built. */
export function clientProcessPath(metaUrl = import.meta.url): string {
  const here = dirname(fileURLToPath(metaUrl));
  const source = join(here, "process.ts");
  if (existsSync(source)) return source;
  return join(here, "process.js");
}
