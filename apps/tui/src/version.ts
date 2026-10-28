import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve package version from nearby package.json (src, dist, or publish root). */
export function packageVersion(metaUrl = import.meta.url): string {
  const here = dirname(fileURLToPath(metaUrl));
  for (const candidate of [
    join(here, "package.json"),
    join(here, "../package.json"),
    join(here, "../../package.json"),
  ]) {
    try {
      const raw = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
      if (typeof raw.version === "string" && raw.version.trim()) return raw.version.trim();
    } catch {
      // try next
    }
  }
  return "unknown";
}

/** One-line `/version` output. */
export function formatVersionLine(metaUrl = import.meta.url): string {
  return `min ${packageVersion(metaUrl)} (node ${process.version})`;
}
