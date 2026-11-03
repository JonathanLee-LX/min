import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyAuthToEnv, legacyConfigNotice, loadMinConfig, resolveMinConfig } from "./load.js";
import {
  defaultSessionDir,
  legacyProjectConfigPath,
  legacyUserConfigPath,
  permissionRulesPath,
  projectId,
  projectMcpPath,
  projectSettingsLocalPath,
  projectSettingsPath,
  userAuthPath,
  userConfigPath,
  userCronJobsPath,
  userKeybindingsPath,
  userMcpPath,
  userMinDir,
  userProjectConfigPath,
  userProjectMcpPath,
  userProvidersPath,
  userSettingsPath,
} from "./paths.js";

function tempHomeAndProject(label: string): { home: string; project: string } {
  const root = mkdtempSync(path.join(tmpdir(), label));
  const home = path.join(root, "home");
  const project = path.join(root, "repo");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { home, project };
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

describe("config path tree", () => {
  it("pins every user and project file", () => {
    const home = "/home/me";
    const cwd = "/work/app";
    const id = "work--app";
    expect(projectId(cwd)).toBe(id);
    expect(projectId("/")).toBe("project");
    expect(projectId("/work/my app")).toBe("work--my-app");
    expect(userMinDir(home)).toBe(path.join(home, ".min"));
    expect(userConfigPath(home)).toBe(path.join(home, ".min", "config.json"));
    expect(userSettingsPath(home)).toBe(path.join(home, ".min", "settings.json"));
    expect(userAuthPath(home)).toBe(path.join(home, ".min", "auth.json"));
    expect(userProvidersPath(home)).toBe(path.join(home, ".min", "providers.json"));
    expect(userKeybindingsPath(home)).toBe(path.join(home, ".min", "keybindings.json"));
    expect(userMcpPath(home)).toBe(path.join(home, ".min", "mcp.json"));
    expect(userCronJobsPath(home)).toBe(path.join(home, ".min", "cron", "jobs.json"));
    expect(userProjectConfigPath(cwd, home)).toBe(
      path.join(home, ".min", "projects", id, "config.json"),
    );
    expect(userProjectMcpPath(cwd, home)).toBe(
      path.join(home, ".min", "projects", id, "mcp.json"),
    );
    expect(projectSettingsPath(cwd)).toBe(path.join(cwd, ".min", "settings.json"));
    expect(projectSettingsLocalPath(cwd)).toBe(path.join(cwd, ".min", "settings.local.json"));
    expect(projectMcpPath(cwd)).toBe(path.join(cwd, ".mcp.json"));
    expect(legacyUserConfigPath(home)).toBe(path.join(home, ".config", "min", "config.json"));
    expect(legacyProjectConfigPath(cwd)).toBe(path.join(cwd, ".min", "config.json"));
    expect(permissionRulesPath(cwd)).toBe(path.join(cwd, ".min", "permissions.json"));
    expect(defaultSessionDir(cwd)).toBe(path.join(cwd, ".min", "sessions"));
  });
});

describe("layered files", () => {
  it("records every contributing file from low to high and merges by name", () => {
    const { home, project } = tempHomeAndProject("min-all-files-");
    writeJson(legacyUserConfigPath(home), { version: 1, provider: "legacy-user", model: "old" });
    writeJson(userConfigPath(home), {
      version: 1,
      provider: "user",
      ui: { theme: "user", keybindings: { esc: "clear" } },
    });
    writeJson(userKeybindingsPath(home), { version: 1, bindings: { enter: "newline" } });
    writeJson(userSettingsPath(home), {
      version: 1,
      permissions: { bash: "ask", read: "allow" },
      hooks: { start: "user" },
    });
    writeJson(userProvidersPath(home), {
      providers: { acme: { kind: "openai", model: "gpt" } },
    });
    writeJson(userAuthPath(home), { keys: { OPENAI_API_KEY: "from-file" } });
    writeJson(userCronJobsPath(home), {
      jobs: [{ id: "daily", schedule: "0 9 * * *", enabled: true }],
    });
    writeJson(userMcpPath(home), {
      mcpServers: {
        docs: { command: "user-docs" },
        local: { command: "user-local" },
      },
    });
    writeJson(legacyProjectConfigPath(project), {
      version: 1,
      model: "repo",
      ui: { theme: "repo" },
    });
    writeJson(projectSettingsPath(project), {
      permissions: { bash: "allow" },
      hooks: { end: "repo" },
    });
    writeJson(projectMcpPath(project), {
      mcpServers: { docs: { command: "repo-docs" }, shared: { url: "https://example.test/sse" } },
    });
    writeJson(userProjectConfigPath(project, home), {
      version: 1,
      ui: { theme: "machine" },
    });
    writeJson(userProjectMcpPath(project, home), {
      mcpServers: { local: { command: "machine-local" } },
    });
    writeJson(projectSettingsLocalPath(project), {
      permissions: { write: "ask" },
      mcp: { enabled: false },
      hooks: { start: "local" },
    });

    const loaded = loadMinConfig({ cwd: project, home, env: {} });
    expect(loaded.config.sources).toEqual([
      "defaults",
      userConfigPath(home),
      userKeybindingsPath(home),
      userSettingsPath(home),
      userProvidersPath(home),
      userAuthPath(home),
      userCronJobsPath(home),
      userMcpPath(home),
      projectSettingsPath(project),
      projectMcpPath(project),
      userProjectConfigPath(project, home),
      userProjectMcpPath(project, home),
      projectSettingsLocalPath(project),
    ]);
    expect(loaded.config.provider).toBe("user");
    expect(loaded.config.model).toBeUndefined();
    expect(loaded.warnings).toEqual([
      legacyConfigNotice(legacyUserConfigPath(home), userConfigPath(home)),
      legacyConfigNotice(legacyProjectConfigPath(project), userProjectConfigPath(project, home)),
    ]);
    expect(loaded.config.ui.theme).toBe("machine");
    expect(loaded.config.ui.keybindings).toEqual({ esc: "clear", enter: "newline" });
    expect(loaded.config.settings).toEqual({
      permissions: { bash: "allow", read: "allow", write: "ask" },
      hooks: { start: "local", end: "repo" },
      mcp: { enabled: false },
    });
    expect(loaded.config.providers).toEqual({ acme: { kind: "openai", model: "gpt" } });
    expect(loaded.config.auth).toEqual({ OPENAI_API_KEY: "from-file" });
    expect(loaded.config.cronJobs).toEqual([
      { id: "daily", schedule: "0 9 * * *", enabled: true },
    ]);
    expect(loaded.config.mcpServers).toEqual([
      { name: "docs", transport: "stdio", command: "repo-docs" },
      { name: "local", transport: "stdio", command: "machine-local" },
      { name: "shared", transport: "sse", url: "https://example.test/sse" },
    ]);
  });

  it("lets a later keybindings file replace one chord without dropping the others", () => {
    const { home, project } = tempHomeAndProject("min-keys-");
    writeJson(userConfigPath(home), {
      version: 1,
      ui: { keybindings: { enter: "submit", "ctrl+j": "newline" } },
    });
    writeJson(userKeybindingsPath(home), { keybindings: { enter: "newline" } });
    const loaded = loadMinConfig({ cwd: project, home, env: {} });
    expect(loaded.config.ui.keybindings).toEqual({
      enter: "newline",
      "ctrl+j": "newline",
    });
  });

  it("ignores invalid JSON and blank files without dropping other layers", () => {
    const { home, project } = tempHomeAndProject("min-bad-json-");
    mkdirSync(path.dirname(userConfigPath(home)), { recursive: true });
    writeFileSync(userConfigPath(home), "{");
    writeFileSync(userSettingsPath(home), "   \n");
    writeJson(userAuthPath(home), { keys: { DEMO_KEY: "secret" } });
    writeJson(projectSettingsPath(project), { permissions: { bash: "deny" } });

    const loaded = loadMinConfig({ cwd: project, home, env: {} });
    expect(loaded.config.provider).toBeUndefined();
    expect(loaded.config.settings.permissions).toEqual({ bash: "deny" });
    expect(loaded.config.auth).toEqual({ DEMO_KEY: "secret" });
    expect(loaded.config.sources).not.toContain(userConfigPath(home));
    expect(loaded.config.sources).not.toContain(userSettingsPath(home));
    expect(loaded.warnings.some((warning) => warning.includes(`ignored invalid JSON in ${userConfigPath(home)}`))).toBe(
      true,
    );
  });

  it("does not record a source for an empty sidecar", () => {
    const { home, project } = tempHomeAndProject("min-empty-sidecar-");
    writeJson(userKeybindingsPath(home), { bindings: {} });
    writeJson(userProvidersPath(home), { providers: { bad: { model: "x" } } });
    writeJson(userAuthPath(home), { keys: {} });
    writeJson(userCronJobsPath(home), { jobs: [{ schedule: "0 * * * *" }] });
    const loaded = loadMinConfig({ cwd: project, home, env: {} });
    expect(loaded.config.sources).toEqual(["defaults"]);
    expect(loaded.config.providers).toEqual({});
    expect(loaded.config.cronJobs).toEqual([]);
    expect(loaded.warnings.some((warning) => /needs a kind string/.test(warning))).toBe(true);
  });

  it("still records an mcp file that parses to an empty server list", () => {
    const { home, project } = tempHomeAndProject("min-empty-mcp-");
    writeJson(userMcpPath(home), { mcpServers: {} });
    const loaded = loadMinConfig({ cwd: project, home, env: {} });
    expect(loaded.config.mcpServers).toEqual([]);
    expect(loaded.config.sources).toContain(userMcpPath(home));
  });

  it("skipFiles ignores a planted project file", () => {
    const { home, project } = tempHomeAndProject("min-skip-");
    writeJson(legacyProjectConfigPath(project), { version: 1, provider: "from-disk" });
    const loaded = loadMinConfig({
      cwd: project,
      home,
      skipFiles: true,
      env: { MIN_MODEL: "from-env" },
    });
    expect(loaded.config.provider).toBeUndefined();
    expect(loaded.config.model).toBe("from-env");
    expect(loaded.config.sources).toEqual(["defaults", "env"]);
  });

  it("userPath replaces the whole ~/.min tree", () => {
    const { home, project } = tempHomeAndProject("min-isolated-user-");
    const isolated = path.join(project, "isolated.json");
    writeJson(userConfigPath(home), { version: 1, provider: "home" });
    writeJson(userKeybindingsPath(home), { bindings: { enter: "newline" } });
    writeJson(userAuthPath(home), { keys: { DEMO_KEY: "secret" } });
    writeJson(userProjectConfigPath(project, home), { version: 1, model: "machine" });
    writeJson(isolated, { version: 1, provider: "isolated" });
    writeJson(projectSettingsPath(project), { permissions: { bash: "allow" } });

    const loaded = loadMinConfig({ cwd: project, home, userPath: isolated, env: {} });
    expect(loaded.config.provider).toBe("isolated");
    expect(loaded.config.model).toBeUndefined();
    expect(loaded.config.ui.keybindings).toBeUndefined();
    expect(loaded.config.auth).toEqual({});
    expect(loaded.config.settings.permissions).toEqual({ bash: "allow" });
    expect(loaded.config.sources).toEqual([
      "defaults",
      isolated,
      projectSettingsPath(project),
    ]);
  });

  it("projectPath replaces the legacy project config and skips per-project state", () => {
    const { home, project } = tempHomeAndProject("min-project-path-");
    const extra = path.join(project, "extra.json");
    writeJson(legacyProjectConfigPath(project), { version: 1, provider: "legacy" });
    writeJson(userProjectConfigPath(project, home), { version: 1, model: "machine" });
    writeJson(extra, { version: 1, provider: "extra", model: "extra-model" });
    const loaded = loadMinConfig({ cwd: project, home, projectPath: extra, env: {} });
    expect(loaded.config.provider).toBe("extra");
    expect(loaded.config.model).toBe("extra-model");
    expect(loaded.config.sources).toEqual(["defaults", extra]);
  });

  it("does not add an env source for blank or non-positive MIN_* values", () => {
    const loaded = loadMinConfig({
      cwd: "/tmp",
      skipFiles: true,
      env: {
        MIN_MAX_TURNS: "0",
        MIN_MAX_CONTEXT_TOKENS: "nope",
        MIN_THEME: "  ",
        MIN_PROVIDER: "",
      },
    });
    expect(loaded.config.sources).toEqual(["defaults"]);
    expect(loaded.config.runtime).toEqual({});
  });

  it("keeps sidecars when flags override preferences", () => {
    const { home, project } = tempHomeAndProject("min-flags-keep-");
    writeJson(userConfigPath(home), {
      version: 1,
      provider: "file",
      runtime: { maxTurns: 8 },
      ui: { theme: "file", keybindings: { enter: "newline" } },
    });
    writeJson(userSettingsPath(home), { permissions: { bash: "allow" } });
    writeJson(userAuthPath(home), { keys: { DEMO_KEY: "secret" } });
    writeJson(userProvidersPath(home), { providers: { acme: { kind: "openai" } } });
    writeJson(userCronJobsPath(home), { jobs: [{ id: "daily" }] });
    writeJson(userMcpPath(home), { mcpServers: { docs: { command: "docs" } } });

    const resolved = resolveMinConfig(
      { cwd: project, home, env: {} },
      { provider: "flag", theme: "flag-theme", maxTurns: 3 },
    );
    expect(resolved.config.provider).toBe("flag");
    expect(resolved.config.ui.theme).toBe("flag-theme");
    expect(resolved.config.runtime.maxTurns).toBe(3);
    expect(resolved.config.ui.keybindings).toEqual({ enter: "newline" });
    expect(resolved.config.settings.permissions).toEqual({ bash: "allow" });
    expect(resolved.config.auth).toEqual({ DEMO_KEY: "secret" });
    expect(resolved.config.providers).toEqual({ acme: { kind: "openai" } });
    expect(resolved.config.cronJobs).toEqual([{ id: "daily" }]);
    expect(resolved.config.mcpServers).toEqual([
      { name: "docs", transport: "stdio", command: "docs" },
    ]);
    expect(resolved.config.sources.at(-1)).toBe("flags");
  });
});

describe("applyAuthToEnv", () => {
  it("fills unset variables and leaves existing values alone", () => {
    const env: NodeJS.ProcessEnv = { ALREADY: "keep" };
    applyAuthToEnv(
      {
        ALREADY: "new",
        OPENAI_API_KEY: "sk-test",
        EMPTY: "",
        "not-a-var": "nope",
        "1BAD": "nope",
      },
      env,
    );
    expect(env.ALREADY).toBe("keep");
    expect(env.OPENAI_API_KEY).toBe("sk-test");
    expect(env.EMPTY).toBe("");
    expect(env["not-a-var"]).toBeUndefined();
    expect(env["1BAD"]).toBeUndefined();
  });
});
