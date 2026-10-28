import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Dependency direction for the first alpha.
 * Edges are "may depend on". Anything else is an architecture break.
 */
const ALLOWED: Record<string, readonly string[]> = {
  "@min-agent/core": [],
  "@min-agent/config": [],
  "@min-agent/tools": ["@min-agent/core"],
  "@min-agent/session": ["@min-agent/core"],
  "@min-agent/skills": ["@min-agent/core", "@min-agent/tools"],
  "@min-agent/providers": ["@min-agent/core"],
  "@min-agent/mcp": ["@min-agent/core"],
  "@min-agent/runtime": [
    "@min-agent/core",
    "@min-agent/providers",
    "@min-agent/session",
    "@min-agent/skills",
    "@min-agent/tools",
  ],
  "@min-agent/client": ["@min-agent/core", "@min-agent/runtime", "@min-agent/session"],
  "@min-agent/render": [],
};

describe("monorepo dependency direction", () => {
  it("keeps package edges inside the designed DAG", () => {
    const checked: string[] = [];
    for (const dir of readdirSync(PACKAGES)) {
      const pkgPath = path.join(PACKAGES, dir, "package.json");
      let pkg: { name?: string; dependencies?: Record<string, string> };
      try {
        pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as typeof pkg;
      } catch {
        continue;
      }
      if (!pkg.name || !pkg.name.startsWith("@min-agent/")) continue;
      const allowed = ALLOWED[pkg.name];
      expect(allowed, `add ${pkg.name} to ALLOWED dependency matrix`).toBeDefined();
      const minDeps = Object.keys(pkg.dependencies ?? {}).filter((name) =>
        name.startsWith("@min-agent/"),
      );
      for (const dep of minDeps) {
        expect(allowed, `${pkg.name} must not depend on ${dep}`).toContain(dep);
      }
      checked.push(pkg.name);
    }
    expect(checked.sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it("keeps core at the bottom of the DAG with no @min-agent deps", () => {
    const core = JSON.parse(
      readFileSync(path.join(PACKAGES, "core", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(
      Object.keys(core.dependencies ?? {}).filter((name) => name.startsWith("@min-agent/")),
    ).toEqual([]);
  });

  it("keeps config and tools permissionRulesPath formulas identical", () => {
    const configPaths = readFileSync(
      path.join(PACKAGES, "config", "src", "paths.ts"),
      "utf8",
    );
    const toolsGrants = readFileSync(
      path.join(PACKAGES, "tools", "src", "grants.ts"),
      "utf8",
    );
    const extract = (source: string, name: string) => {
      const match = source.match(
        new RegExp(`export function ${name}\\([^)]*\\)[^{]*\\{([^}]+)\\}`),
      );
      expect(match, `${name} missing`).toBeTruthy();
      return match![1]!.replace(/\s+/g, " ").trim();
    };
    expect(extract(configPaths, "permissionRulesPath")).toBe(
      extract(toolsGrants, "permissionRulesPath"),
    );
    expect(extract(configPaths, "permissionRulesPath")).toContain(
      '.min", "permissions.json"',
    );
  });

  it("keeps config defaultSessionDir aligned with runtime sessionDirFor", () => {
    const configPaths = readFileSync(
      path.join(PACKAGES, "config", "src", "paths.ts"),
      "utf8",
    );
    const runtime = readFileSync(
      path.join(PACKAGES, "runtime", "src", "runtime.ts"),
      "utf8",
    );
    expect(configPaths).toContain('.min", "sessions"');
    expect(runtime).toMatch(/\.min\/sessions/);
  });
});
