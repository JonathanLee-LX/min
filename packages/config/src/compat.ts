import { parseReasoningEffort } from "@min-agent/core";
import path from "node:path";
import {
  parseMcpFile,
  parseProvidersFile,
} from "./files.js";
import {
  claudeJsonPath,
  claudeProjectSettingsLocalPath,
  claudeProjectSettingsPath,
  claudeUserSettingsPath,
  codexProjectConfigPath,
  codexUserConfigPath,
  cursorProjectCliConfigPath,
  cursorProjectMcpPath,
  cursorUserCliConfigPath,
  cursorUserMcpPath,
} from "./compat-paths.js";
import { parseToml } from "./toml.js";
import { CONFIG_VERSION, type McpServerEntry, type MinConfigDocument, type ProviderSpec } from "./types.js";

export interface CompatLayer {
  source: string;
  document?: MinConfigDocument;
  auth?: Record<string, string>;
  providers?: Record<string, ProviderSpec>;
  mcpServers?: McpServerEntry[];
}

export interface LoadCompatOptions {
  cwd: string;
  home: string;
  env: NodeJS.ProcessEnv;
  readJson: (file: string) => unknown | undefined;
  readText: (file: string) => string | undefined;
  warnings: string[];
}

const CLAUDE_MODEL_ALIAS: Record<string, string> = {
  sonnet: "claude-sonnet-4-5",
  opus: "claude-opus-4-5",
  haiku: "claude-haiku-4-5",
};

/**
 * Foreign agent files, lowest first. min files load after these so they win.
 * User Claude Code / Codex / Cursor, then the matching project files.
 */
export function loadCompatLayers(opts: LoadCompatOptions, isolatedUser: boolean): CompatLayer[] {
  const layers: CompatLayer[] = [];
  if (!isolatedUser) {
    pushClaudeJson(layers, opts, "user");
    pushClaudeSettings(layers, claudeUserSettingsPath(opts.home, opts.env), opts);
    pushCodexToml(layers, codexUserConfigPath(opts.home, opts.env), opts);
    pushMcpJson(layers, cursorUserMcpPath(opts.home, opts.env), opts);
    pushCursorCli(layers, cursorUserCliConfigPath(opts.home, opts.env), opts);
    pushClaudeJson(layers, opts, "project");
  }
  pushClaudeSettings(layers, claudeProjectSettingsPath(opts.cwd), opts);
  pushClaudeSettings(layers, claudeProjectSettingsLocalPath(opts.cwd), opts);
  pushCodexToml(layers, codexProjectConfigPath(opts.cwd), opts);
  pushMcpJson(layers, cursorProjectMcpPath(opts.cwd), opts);
  pushCursorCli(layers, cursorProjectCliConfigPath(opts.cwd), opts);
  return layers;
}

export function mergeProviders(
  base: Record<string, ProviderSpec>,
  overlay: Record<string, ProviderSpec>,
): Record<string, ProviderSpec> {
  return { ...base, ...overlay };
}

export function mergeAuth(
  base: Record<string, string>,
  overlay: Record<string, string>,
): Record<string, string> {
  return { ...base, ...overlay };
}

function pushMcpJson(layers: CompatLayer[], file: string, opts: LoadCompatOptions): void {
  const json = opts.readJson(file);
  if (json === undefined) return;
  const parsed = parseMcpFile(json);
  for (const warning of parsed.warnings) opts.warnings.push(`${file}: ${warning}`);
  layers.push({ source: file, mcpServers: parsed.value });
}

function pushClaudeJson(
  layers: CompatLayer[],
  opts: LoadCompatOptions,
  scope: "user" | "project",
): void {
  const file = claudeJsonPath(opts.home);
  const json = opts.readJson(file);
  if (!isPlain(json)) return;
  const table =
    scope === "user"
      ? json.mcpServers
      : projectClaudeMcp(json, opts.cwd);
  if (!isPlain(table)) return;
  const parsed = parseMcpFile({ mcpServers: table });
  for (const warning of parsed.warnings) opts.warnings.push(`${file}: ${warning}`);
  layers.push({ source: `${file}#${scope}`, mcpServers: parsed.value });
}

function pushClaudeSettings(layers: CompatLayer[], file: string, opts: LoadCompatOptions): void {
  const json = opts.readJson(file);
  if (!isPlain(json)) return;
  const layer: CompatLayer = { source: file };
  if (isPlain(json.mcpServers) || isPlain(json.servers)) {
    const parsed = parseMcpFile(json);
    for (const warning of parsed.warnings) opts.warnings.push(`${file}: ${warning}`);
    layer.mcpServers = parsed.value;
  }
  const auth = stringMap(json.env);
  if (Object.keys(auth).length > 0) layer.auth = auth;
  const document = documentFromModel(json.model, "anthropic");
  if (document) layer.document = document;
  if (layer.mcpServers || layer.auth || layer.document) layers.push(layer);
}

function pushCodexToml(layers: CompatLayer[], file: string, opts: LoadCompatOptions): void {
  const raw = opts.readText(file);
  if (raw === undefined) return;
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(raw);
  } catch (err) {
    opts.warnings.push(
      `ignored invalid TOML in ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  const layer: CompatLayer = { source: file };
  if (isPlain(parsed.mcp_servers)) {
    const mcp = parseMcpFile({ mcpServers: parsed.mcp_servers });
    for (const warning of mcp.warnings) opts.warnings.push(`${file}: ${warning}`);
    layer.mcpServers = mcp.value;
  }
  const providers = providersFromCodex(parsed.model_providers, opts.warnings, file);
  if (Object.keys(providers).length > 0) layer.providers = providers;
  const document = documentFromCodex(parsed, providers);
  if (document) layer.document = document;
  if (layer.mcpServers || layer.providers || layer.document) layers.push(layer);
}

function pushCursorCli(layers: CompatLayer[], file: string, opts: LoadCompatOptions): void {
  const json = opts.readJson(file);
  if (!isPlain(json)) return;
  const model = cursorModelId(json);
  const document = documentFromModel(model);
  if (!document) return;
  layers.push({ source: file, document });
}

function projectClaudeMcp(json: Record<string, unknown>, cwd: string): unknown {
  if (!isPlain(json.projects)) return undefined;
  const abs = path.resolve(cwd);
  const projects = json.projects;
  const direct = projects[abs] ?? projects[cwd];
  if (isPlain(direct)) return direct.mcpServers;
  for (const [key, value] of Object.entries(projects)) {
    if (path.resolve(key) === abs && isPlain(value)) return value.mcpServers;
  }
  return undefined;
}

function providersFromCodex(
  value: unknown,
  warnings: string[],
  file: string,
): Record<string, ProviderSpec> {
  if (!isPlain(value)) return {};
  const table: Record<string, unknown> = {};
  for (const [id, spec] of Object.entries(value)) {
    if (!isPlain(spec)) continue;
    const mapped = mapCodexProvider(id, spec);
    if (!mapped) {
      warnings.push(`${file}: model provider "${id}" needs a base_url`);
      continue;
    }
    table[id] = mapped;
  }
  return parseProvidersFile({ providers: table }).value;
}

function mapCodexProvider(id: string, spec: Record<string, unknown>): Record<string, unknown> | undefined {
  const baseUrl =
    (typeof spec.base_url === "string" && spec.base_url.trim()) ||
    (typeof spec.baseUrl === "string" && spec.baseUrl.trim()) ||
    "";
  if (!baseUrl) return undefined;
  const wire = typeof spec.wire_api === "string" ? spec.wire_api.trim().toLowerCase() : "";
  const kind =
    wire === "chat" || wire === "completions" ? "openai-chat"
    : looksAnthropic(id, baseUrl) ? "anthropic"
    : "openai";
  const out: Record<string, unknown> = { kind, baseUrl };
  if (typeof spec.env_key === "string" && spec.env_key.trim()) out.apiKeyEnv = spec.env_key.trim();
  else if (typeof spec.envKey === "string" && spec.envKey.trim()) out.apiKeyEnv = spec.envKey.trim();
  return out;
}

function documentFromCodex(
  parsed: Record<string, unknown>,
  providers: Record<string, ProviderSpec>,
): MinConfigDocument | undefined {
  const model = typeof parsed.model === "string" ? parsed.model.trim() : "";
  const providerName =
    typeof parsed.model_provider === "string" ? parsed.model_provider.trim() : "";
  const named = providerName ? providers[providerName] : undefined;
  const kind = named ? providerName : providerName || inferProviderKind(model);
  const effortRaw =
    typeof parsed.model_reasoning_effort === "string"
      ? mapCodexEffort(parsed.model_reasoning_effort)
      : undefined;
  const reasoningEffort = effortRaw ? parseReasoningEffort(effortRaw) : undefined;
  if (!model && !kind && !reasoningEffort) return undefined;
  return {
    version: CONFIG_VERSION,
    ...(kind ? { provider: kind } : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

function documentFromModel(model: unknown, fallbackKind?: string): MinConfigDocument | undefined {
  const id = typeof model === "string" ? expandClaudeModel(model.trim()) : "";
  if (!id) return undefined;
  const kind = inferProviderKind(id) ?? fallbackKind;
  return {
    version: CONFIG_VERSION,
    ...(kind ? { provider: kind } : {}),
    model: id,
  };
}

function cursorModelId(json: Record<string, unknown>): string | undefined {
  const selected = json.selectedModel;
  if (isPlain(selected) && typeof selected.modelId === "string" && selected.modelId.trim()) {
    return selected.modelId.trim();
  }
  const model = json.model;
  if (typeof model === "string" && model.trim()) return model.trim();
  if (isPlain(model)) {
    if (typeof model.modelId === "string" && model.modelId.trim()) return model.modelId.trim();
    if (typeof model.id === "string" && model.id.trim()) return model.id.trim();
  }
  return undefined;
}

export function inferProviderKind(model: string): string | undefined {
  const m = model.trim().toLowerCase();
  if (!m) return undefined;
  if (
    m.includes("claude") ||
    m.includes("anthropic") ||
    m === "sonnet" ||
    m === "opus" ||
    m === "haiku" ||
    /(^|[^a-z])sonnet([^a-z]|$)/.test(m) ||
    /(^|[^a-z])opus([^a-z]|$)/.test(m) ||
    /(^|[^a-z])haiku([^a-z]|$)/.test(m)
  ) {
    return "anthropic";
  }
  if (m.includes("deepseek")) return "deepseek";
  if (
    m.startsWith("gpt") ||
    /^o[1-9]/.test(m) ||
    m.includes("openai") ||
    m.startsWith("chatgpt") ||
    m.includes("codex")
  ) {
    return "openai";
  }
  return undefined;
}

function expandClaudeModel(model: string): string {
  if (!model) return model;
  return CLAUDE_MODEL_ALIAS[model.toLowerCase()] ?? model;
}

function mapCodexEffort(value: string): string {
  const effort = value.trim().toLowerCase();
  if (effort === "minimal" || effort === "min") return "low";
  if (effort === "xhigh" || effort === "x-high") return "max";
  return effort;
}

function looksAnthropic(id: string, baseUrl: string): boolean {
  const hay = `${id} ${baseUrl}`.toLowerCase();
  return hay.includes("anthropic") || hay.includes("claude");
}

function stringMap(value: unknown): Record<string, string> {
  if (!isPlain(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = entry;
  }
  return out;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
