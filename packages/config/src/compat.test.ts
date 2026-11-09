import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  claudeJsonPath,
  claudeUserSettingsPath,
  codexUserConfigPath,
  cursorUserCliConfigPath,
  cursorUserMcpPath,
  loadMinConfig,
  providerLaunchSpec,
  userAuthPath,
  userConfigPath,
  userMcpPath,
  userProvidersPath,
} from "./index.js";

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

describe("foreign agent config", () => {
  it("loads Claude Code, Codex, and Cursor below min files so min wins", () => {
    const { home, project } = tempHomeAndProject("min-compat-");
    writeJson(claudeJsonPath(home), {
      mcpServers: {
        docs: { command: "claude-docs" },
        local: { command: "claude-local" },
      },
      projects: {
        [project]: {
          mcpServers: { local: { command: "claude-project-local" } },
        },
      },
    });
    writeJson(claudeUserSettingsPath(home), {
      model: "sonnet",
      env: { ANTHROPIC_API_KEY: "from-claude" },
    });
    mkdirSync(path.dirname(codexUserConfigPath(home)), { recursive: true });
    writeFileSync(
      codexUserConfigPath(home),
      [
        'model = "gpt-5"',
        'model_provider = "acme"',
        'model_reasoning_effort = "xhigh"',
        "",
        "[mcp_servers.remote]",
        'url = "https://codex.test/mcp"',
        "",
        "[mcp_servers.disabled]",
        'command = "nope"',
        "enabled = false",
        "",
        "[model_providers.acme]",
        'base_url = "https://codex.test/v1"',
        'env_key = "ACME_API_KEY"',
        'wire_api = "chat"',
      ].join("\n"),
    );
    writeJson(cursorUserMcpPath(home), {
      mcpServers: {
        cursor: { command: "cursor-mcp" },
        docs: { type: "http", url: "https://cursor.test/mcp" },
      },
    });
    writeJson(cursorUserCliConfigPath(home), {
      version: 1,
      model: { modelId: "gpt-5" },
    });
    writeJson(userConfigPath(home), {
      version: 1,
      provider: "deepseek",
      model: "deepseek-flash",
    });
    writeJson(userMcpPath(home), {
      mcpServers: { docs: { command: "min-docs" } },
    });
    writeJson(userProvidersPath(home), {
      providers: { acme: { kind: "openai", model: "min-model", baseUrl: "https://min.test/v1" } },
    });
    writeJson(userAuthPath(home), { keys: { ANTHROPIC_API_KEY: "from-min" } });

    const loaded = loadMinConfig({ cwd: project, home, env: {} });
    expect(loaded.config.provider).toBe("deepseek");
    expect(loaded.config.model).toBe("deepseek-flash");
    expect(loaded.config.reasoningEffort).toBe("max");
    expect(loaded.config.auth).toEqual({ ANTHROPIC_API_KEY: "from-min" });
    expect(loaded.config.providers).toEqual({
      acme: {
        kind: "openai",
        model: "min-model",
        baseUrl: "https://min.test/v1",
      },
    });
    expect(loaded.config.mcpServers).toEqual([
      { name: "docs", transport: "stdio", command: "min-docs" },
      { name: "local", transport: "stdio", command: "claude-project-local" },
      { name: "remote", transport: "sse", url: "https://codex.test/mcp" },
      { name: "cursor", transport: "stdio", command: "cursor-mcp" },
    ]);
    expect(loaded.config.sources[0]).toBe("defaults");
    expect(loaded.config.sources.indexOf(`${claudeJsonPath(home)}#user`)).toBeGreaterThan(0);
    expect(loaded.config.sources.indexOf(userMcpPath(home))).toBeGreaterThan(
      loaded.config.sources.indexOf(cursorUserMcpPath(home)),
    );
  });

  it("uses a named Codex provider until min overrides the active provider", () => {
    const { home, project } = tempHomeAndProject("min-compat-named-");
    mkdirSync(path.dirname(codexUserConfigPath(home)), { recursive: true });
    writeFileSync(
      codexUserConfigPath(home),
      [
        'model = "proxy-model"',
        'model_provider = "acme"',
        "[model_providers.acme]",
        'base_url = "https://codex.test/v1"',
        'env_key = "ACME_API_KEY"',
        'wire_api = "chat"',
      ].join("\n"),
    );
    const loaded = loadMinConfig({ cwd: project, home, env: {} });
    expect(loaded.config.provider).toBe("acme");
    expect(loaded.config.model).toBe("proxy-model");
    expect(providerLaunchSpec(loaded.config)).toEqual({
      kind: "openai-chat",
      model: "proxy-model",
      baseUrl: "https://codex.test/v1",
      apiKeyEnv: "ACME_API_KEY",
    });
  });

  it("maps Claude http MCP and Cursor model ids without touching min when min is empty", () => {
    const { home, project } = tempHomeAndProject("min-compat-empty-min-");
    writeJson(claudeUserSettingsPath(home), { model: "haiku" });
    writeJson(path.join(project, ".cursor", "mcp.json"), {
      mcpServers: { web: { type: "http", url: "https://cursor.test/sse" } },
    });
    const loaded = loadMinConfig({ cwd: project, home, env: {} });
    expect(loaded.config.provider).toBe("anthropic");
    expect(loaded.config.model).toBe("claude-haiku-4-5");
    expect(loaded.config.mcpServers).toEqual([
      { name: "web", transport: "sse", url: "https://cursor.test/sse" },
    ]);
  });

  it("skipFiles ignores planted Claude and Cursor files", () => {
    const { home, project } = tempHomeAndProject("min-compat-skip-");
    writeJson(claudeUserSettingsPath(home), { model: "opus" });
    writeJson(cursorUserMcpPath(home), { mcpServers: { docs: { command: "cursor" } } });
    const loaded = loadMinConfig({
      cwd: project,
      home,
      skipFiles: true,
      env: { MIN_MODEL: "from-env" },
    });
    expect(loaded.config.model).toBe("from-env");
    expect(loaded.config.provider).toBeUndefined();
    expect(loaded.config.mcpServers).toEqual([]);
    expect(loaded.config.sources).toEqual(["defaults", "env"]);
  });

  it("does not load user-scope foreign files when userPath isolates the home tree", () => {
    const { home, project } = tempHomeAndProject("min-compat-isolated-");
    const isolated = path.join(project, "isolated.json");
    writeJson(claudeUserSettingsPath(home), { model: "opus" });
    writeJson(isolated, { version: 1, provider: "mock" });
    const loaded = loadMinConfig({ cwd: project, home, userPath: isolated, env: {} });
    expect(loaded.config.provider).toBe("mock");
    expect(loaded.config.model).toBeUndefined();
    expect(loaded.config.sources).toEqual(["defaults", isolated]);
  });
});
