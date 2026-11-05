import { noticeLog } from "@min-agent/core";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFlagOverrides,
  loadMinConfig,
  mergeDocuments,
  parseConfigDocument,
  projectId,
  projectMcpPath,
  projectSettingsLocalPath,
  projectSettingsPath,
  resolveMinConfig,
  legacyConfigNotice,
  legacyProjectConfigPath,
  legacyUserConfigPath,
  userConfigPath,
  userKeybindingsPath,
  userMcpPath,
  userProjectConfigPath,
  userSettingsPath,
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

  it("parses ui.density compact or comfortable", () => {
    expect(parseConfigDocument({ version: 1, ui: { density: "compact" } }).document.ui).toEqual({
      density: "compact",
    });
    expect(parseConfigDocument({ version: 1, ui: { density: "wide" } }).document.ui).toBeUndefined();
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
    mkdirSync(path.dirname(userConfigPath(userDir)), { recursive: true });
    mkdirSync(path.dirname(userProjectConfigPath(project, userDir)), { recursive: true });
    writeFileSync(
      userConfigPath(userDir),
      JSON.stringify({ version: 1, provider: "user-provider", ui: { theme: "default" } }),
    );
    writeFileSync(
      userProjectConfigPath(project, userDir),
      JSON.stringify({
        version: 1,
        model: "project-model",
        ui: { themeOverrides: { name: "Project" } },
        futureHook: true,
      }),
    );

    const loaded = loadMinConfig({
      cwd: project,
      home: userDir,
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
        home: userDir,
        env: { MIN_THEME: "env-theme" },
      },
      { theme: "flag-theme", provider: "flag-provider" },
    );
    expect(resolved.config.ui.theme).toBe("flag-theme");
    expect(resolved.config.provider).toBe("flag-provider");
    expect(resolved.config.sources.at(-1)).toBe("flags");
  });

  it("stacks command-code files and lets later mcp and keybindings win", () => {
    const root = mkdtempSync(path.join(tmpdir(), "min-layout-"));
    const home = path.join(root, "home");
    const project = path.join(root, "repo");
    mkdirSync(path.dirname(userConfigPath(home)), { recursive: true });
    mkdirSync(path.dirname(userProjectConfigPath(project, home)), { recursive: true });
    mkdirSync(path.join(project, ".min"), { recursive: true });

    writeFileSync(
      userConfigPath(home),
      JSON.stringify({ version: 1, ui: { theme: "user" } }),
    );
    writeFileSync(
      userKeybindingsPath(home),
      JSON.stringify({ version: 1, bindings: { enter: "newline" } }),
    );
    writeFileSync(
      userSettingsPath(home),
      JSON.stringify({ version: 1, permissions: { bash: "ask" }, hooks: { start: "a" } }),
    );
    writeFileSync(
      userMcpPath(home),
      JSON.stringify({ mcpServers: { docs: { command: "user-docs" }, local: { command: "user" } } }),
    );
    writeFileSync(
      projectSettingsPath(project),
      JSON.stringify({ version: 1, permissions: { bash: "allow" } }),
    );
    writeFileSync(
      projectMcpPath(project),
      JSON.stringify({ mcpServers: { docs: { command: "repo-docs" } } }),
    );
    writeFileSync(
      userProjectConfigPath(project, home),
      JSON.stringify({ version: 1, ui: { theme: "machine" } }),
    );
    writeFileSync(
      projectSettingsLocalPath(project),
      JSON.stringify({ version: 1, permissions: { write: "ask" }, mcp: { enabled: false } }),
    );

    const loaded = loadMinConfig({ cwd: project, home, env: {} });
    expect(loaded.config.ui.theme).toBe("machine");
    expect(loaded.config.ui.keybindings).toEqual({ enter: "newline" });
    expect(loaded.config.settings.permissions).toEqual({ bash: "allow", write: "ask" });
    expect(loaded.config.settings.hooks).toEqual({ start: "a" });
    expect(loaded.config.settings.mcp).toEqual({ enabled: false });
    expect(loaded.config.mcpServers).toEqual([
      { name: "docs", transport: "stdio", command: "repo-docs" },
      { name: "local", transport: "stdio", command: "user" },
    ]);
    expect(projectId(project).length).toBeGreaterThan(0);
  });

  it("reads a legacy config.json without letting it change settings", () => {
    const root = mkdtempSync(path.join(tmpdir(), "min-legacy-"));
    const home = path.join(root, "home");
    const project = path.join(root, "repo");
    mkdirSync(path.dirname(legacyUserConfigPath(home)), { recursive: true });
    mkdirSync(path.dirname(legacyProjectConfigPath(project)), { recursive: true });
    mkdirSync(path.dirname(userConfigPath(home)), { recursive: true });
    writeFileSync(
      legacyUserConfigPath(home),
      JSON.stringify({
        version: 1,
        provider: "old-user",
        ui: { theme: "old", keybindings: { enter: "newline" } },
      }),
    );
    writeFileSync(
      legacyProjectConfigPath(project),
      JSON.stringify({ version: 1, model: "old-model", runtime: { maxTurns: 9 } }),
    );
    writeFileSync(userConfigPath(home), JSON.stringify({ version: 1, provider: "new-user" }));

    const before = new Set(noticeLog.list().map((notice) => notice.id));
    const loaded = loadMinConfig({ cwd: project, home, env: {} });
    const recorded = noticeLog.list().filter((notice) => !before.has(notice.id));
    expect(recorded.map((notice) => notice.message)).toEqual(loaded.warnings);
    expect(recorded.every((notice) => notice.source === "config" && notice.level === "warning")).toBe(
      true,
    );
    expect(loaded.config.provider).toBe("new-user");
    expect(loaded.config.model).toBeUndefined();
    expect(loaded.config.ui.theme).toBeUndefined();
    expect(loaded.config.ui.keybindings).toBeUndefined();
    expect(loaded.config.runtime).toEqual({});
    expect(loaded.config.sources).toEqual(["defaults", userConfigPath(home)]);
    expect(loaded.warnings).toEqual([
      legacyConfigNotice(legacyUserConfigPath(home), userConfigPath(home)),
      legacyConfigNotice(legacyProjectConfigPath(project), userProjectConfigPath(project, home)),
    ]);
  });

  it("adds one sample notice when MIN_SIMULATE_NOTICE=1", () => {
    const home = "/home/me";
    const loaded = loadMinConfig({
      cwd: "/tmp",
      home,
      skipFiles: true,
      env: { MIN_SIMULATE_NOTICE: "1" },
    });
    expect(loaded.config.provider).toBeUndefined();
    expect(loaded.warnings).toEqual([
      legacyConfigNotice(legacyUserConfigPath(home), userConfigPath(home)),
    ]);
    expect(loadMinConfig({ cwd: "/tmp", skipFiles: true, env: { MIN_SIMULATE_NOTICE: "0" } }).warnings).toEqual(
      [],
    );
  });

  it("applyFlagOverrides does not invent a flags source when empty", () => {
    const base = loadMinConfig({ cwd: "/tmp", skipFiles: true, env: {} }).config;
    expect(applyFlagOverrides(base, {}).sources).toEqual(["defaults"]);
  });
});
