import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFlagOverrides,
  loadMinConfig,
  mergeDocuments,
  parseConfigDocument,
  projectConfigPath,
  resolveMinConfig,
} from "./index.js";

describe("parseConfigDocument", () => {
  it("keeps unknown keys under extensions for forward compatibility", () => {
    const parsed = parseConfigDocument({
      version: 1,
      provider: "mock",
      experimentalFoo: { on: true },
      extensions: { bar: 1 },
    });
    expect(parsed.document.provider).toBe("mock");
    expect(parsed.unknownKeys).toContain("experimentalFoo");
    expect(parsed.document.extensions).toMatchObject({
      bar: 1,
      experimentalFoo: { on: true },
    });
  });

  it("accepts a newer version with a warning", () => {
    const parsed = parseConfigDocument({ version: 99, ui: { theme: "default" } });
    expect(parsed.document.ui?.theme).toBe("default");
    expect(parsed.warnings.some((warning) => /newer/.test(warning))).toBe(true);
  });
});

describe("merge and load", () => {
  it("lets later layers win while merging nested objects", () => {
    const merged = mergeDocuments(
      { version: 1, provider: "a", runtime: { maxTurns: 10 }, ui: { theme: "default" } },
      {
        version: 1,
        provider: "b",
        runtime: { maxContextTokens: 1000 },
        ui: { themeOverrides: { frames: { chatBar: "| " } } },
      },
    );
    expect(merged.provider).toBe("b");
    expect(merged.runtime).toEqual({ maxTurns: 10, maxContextTokens: 1000 });
    expect(merged.ui?.theme).toBe("default");
    expect(merged.ui?.themeOverrides?.frames).toEqual({ chatBar: "| " });
  });

  it("merges ui.keybindings sparsely across layers", () => {
    const merged = mergeDocuments(
      {
        version: 1,
        ui: { keybindings: { enter: "submit", "ctrl+j": "newline" } },
      },
      {
        version: 1,
        ui: { keybindings: { enter: "newline", "shift+enter": "submit" } },
      },
    );
    expect(merged.ui?.keybindings).toEqual({
      enter: "newline",
      "ctrl+j": "newline",
      "shift+enter": "submit",
    });
  });

  it("loads user then project then env then flags", () => {
    const root = mkdtempSync(path.join(tmpdir(), "min-config-"));
    const userDir = path.join(root, "user");
    const project = path.join(root, "project");
    mkdirSync(path.join(userDir, ".config", "min"), { recursive: true });
    mkdirSync(path.join(project, ".min"), { recursive: true });
    writeFileSync(
      path.join(userDir, ".config", "min", "config.json"),
      JSON.stringify({ version: 1, provider: "user-provider", ui: { theme: "default" } }),
    );
    writeFileSync(
      projectConfigPath(project),
      JSON.stringify({
        version: 1,
        model: "project-model",
        ui: { themeOverrides: { name: "Project" } },
        futureHook: true,
      }),
    );

    const loaded = loadMinConfig({
      cwd: project,
      userPath: path.join(userDir, ".config", "min", "config.json"),
      env: { MIN_THEME: "env-theme", MIN_MAX_TURNS: "12" },
    });
    expect(loaded.config.provider).toBe("user-provider");
    expect(loaded.config.model).toBe("project-model");
    expect(loaded.config.ui.theme).toBe("env-theme");
    expect(loaded.config.runtime.maxTurns).toBe(12);
    expect(loaded.config.ui.themeOverrides?.name).toBe("Project");
    expect(loaded.config.extensions.futureHook).toBe(true);
    expect(loaded.config.sources.at(-1)).toBe("env");

    const resolved = resolveMinConfig(
      {
        cwd: project,
        userPath: path.join(userDir, ".config", "min", "config.json"),
        env: { MIN_THEME: "env-theme" },
      },
      { theme: "flag-theme", provider: "flag-provider" },
    );
    expect(resolved.config.ui.theme).toBe("flag-theme");
    expect(resolved.config.provider).toBe("flag-provider");
    expect(resolved.config.sources.at(-1)).toBe("flags");
  });

  it("applyFlagOverrides does not invent a flags source when empty", () => {
    const base = loadMinConfig({ cwd: "/tmp", skipFiles: true, env: {} }).config;
    expect(applyFlagOverrides(base, {}).sources).toEqual(["defaults"]);
  });
});
