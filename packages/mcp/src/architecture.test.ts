import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as mcp from "./index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("mcp architecture contracts", () => {
  it("depends on core only among @min-agent packages", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const minDeps = Object.keys(pkg.dependencies ?? {}).filter((name) =>
      name.startsWith("@min-agent/"),
    );
    expect(minDeps).toEqual(["@min-agent/core"]);
  });

  it("is an optional host-side connector, not wired by createRuntime", () => {
    expect(typeof mcp.mcp).toBe("function");
    const runtimePkg = JSON.parse(
      readFileSync(path.join(ROOT, "..", "runtime", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(runtimePkg.dependencies ?? {})).not.toContain("@min-agent/mcp");
  });
});
