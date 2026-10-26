import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as providers from "./index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("providers architecture contracts", () => {
  it("depends on core only among @min-agent packages", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const minDeps = Object.keys(pkg.dependencies ?? {}).filter((name) =>
      name.startsWith("@min-agent/"),
    );
    expect(minDeps).toEqual(["@min-agent/core"]);
  });

  it("exposes registry + built-in factory entry points", () => {
    expect(typeof providers.registerProvider).toBe("function");
    expect(typeof providers.createProvider).toBe("function");
    expect(typeof providers.listProviders).toBe("function");
    expect(providers.listProviders().length).toBeGreaterThan(0);
  });

  it("keeps vendor SDK usage out of the registry module", () => {
    const registry = readFileSync(path.join(ROOT, "src", "registry.ts"), "utf8");
    expect(registry).not.toMatch(/from ["']openai["']/);
    expect(registry).not.toMatch(/from ["']@anthropic-ai\/sdk["']/);
    const adapters = readdirSync(path.join(ROOT, "src")).filter(
      (name) =>
        name.endsWith(".ts") &&
        !name.endsWith(".test.ts") &&
        name !== "registry.ts" &&
        name !== "index.ts" &&
        name !== "builtins.ts",
    );
    expect(adapters.length).toBeGreaterThan(0);
  });
});
