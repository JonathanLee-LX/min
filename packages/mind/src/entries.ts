import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveSiblingEntry(
  name: "mind-main" | "client-main",
  metaUrl = import.meta.url,
): { command: string; args: string[] } {
  const here = dirname(fileURLToPath(metaUrl));
  const js = join(here, `${name}.js`);
  const ts = join(here, `${name}.ts`);
  if (existsSync(js)) {
    return { command: process.execPath, args: [js] };
  }
  if (existsSync(ts)) {
    return { command: process.execPath, args: ["--import", "tsx", ts] };
  }
  throw new Error(`${name} entry not found next to ${here}`);
}
