import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Wire protocol for mind RPC and client-process sockets. Starts at 1. */
export const MIND_PROTOCOL = 1;

/** Resolve the build version of this package (same string the frontend compares). */
export function mindBuildVersion(metaUrl = import.meta.url): string {
  const here = dirname(fileURLToPath(metaUrl));
  for (const candidate of [
    join(here, "package.json"),
    join(here, "../package.json"),
    join(here, "../../package.json"),
  ]) {
    try {
      const raw = JSON.parse(readFileSync(candidate, "utf8")) as {
        version?: string;
      };
      if (typeof raw.version === "string" && raw.version.trim()) {
        return raw.version.trim();
      }
    } catch {
      // try next
    }
  }
  return "unknown";
}
