import { CONFIG_VERSION, type MinConfigDocument } from "./types.js";
import type {
  AuthDocument,
  CronJob,
  McpServerEntry,
  MinSettings,
  PermissionModeName,
  ProviderSpec,
} from "./types.js";

export interface FileParse<T> {
  value: T;
  warnings: string[];
}

const MODES = new Set<PermissionModeName>(["allow", "ask", "deny"]);

export function parseKeybindingFile(value: unknown): FileParse<Record<string, string>> {
  const warnings: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: {}, warnings: ["keybindings root must be an object"] };
  }
  const raw = value as Record<string, unknown>;
  noteVersion(raw.version, warnings, "keybindings");
  const source =
    isPlain(raw.bindings) ? raw.bindings
    : isPlain(raw.keybindings) ? raw.keybindings
    : raw;
  return { value: stringMap(source, "version"), warnings };
}

export function parseSettingsFile(value: unknown): FileParse<MinSettings> {
  const warnings: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: {}, warnings: ["settings root must be an object"] };
  }
  const raw = value as Record<string, unknown>;
  noteVersion(raw.version, warnings, "settings");
  const settings: MinSettings = {};
  const permissions = parsePermissions(raw.permissions);
  if (permissions) settings.permissions = permissions;
  if (isPlain(raw.hooks)) settings.hooks = { ...raw.hooks };
  const mcp = parseMcpPolicy(raw.mcp);
  if (mcp) settings.mcp = mcp;

  const known = new Set(["version", "permissions", "hooks", "mcp", "extensions"]);
  const extensions: Record<string, unknown> = {};
  if (isPlain(raw.extensions)) Object.assign(extensions, raw.extensions);
  for (const key of Object.keys(raw)) {
    if (known.has(key)) continue;
    extensions[key] = raw[key];
    warnings.push(`unknown settings key "${key}" kept under extensions`);
  }
  if (Object.keys(extensions).length > 0) settings.extensions = extensions;
  return { value: settings, warnings };
}

export function parseAuthFile(value: unknown): FileParse<AuthDocument> {
  const warnings: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: { version: CONFIG_VERSION, keys: {} }, warnings: ["auth root must be an object"] };
  }
  const raw = value as Record<string, unknown>;
  noteVersion(raw.version, warnings, "auth");
  const keys = stringMap(isPlain(raw.keys) ? raw.keys : {}, undefined);
  return { value: { version: CONFIG_VERSION, keys }, warnings };
}

export function parseProvidersFile(value: unknown): FileParse<Record<string, ProviderSpec>> {
  const warnings: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: {}, warnings: ["providers root must be an object"] };
  }
  const raw = value as Record<string, unknown>;
  noteVersion(raw.version, warnings, "providers");
  const table = isPlain(raw.providers) ? raw.providers : {};
  const providers: Record<string, ProviderSpec> = {};
  for (const [id, spec] of Object.entries(table)) {
    if (!isPlain(spec) || typeof spec.kind !== "string" || !spec.kind.trim()) {
      warnings.push(`provider "${id}" needs a kind string`);
      continue;
    }
    const next: ProviderSpec = { kind: spec.kind.trim() };
    if (typeof spec.model === "string" && spec.model.trim()) next.model = spec.model.trim();
    if (typeof spec.baseUrl === "string" && spec.baseUrl.trim()) next.baseUrl = spec.baseUrl.trim();
    if (typeof spec.apiKeyEnv === "string" && spec.apiKeyEnv.trim()) {
      next.apiKeyEnv = spec.apiKeyEnv.trim();
    }
    if (
      typeof spec.maxContextTokens === "number" &&
      Number.isInteger(spec.maxContextTokens) &&
      spec.maxContextTokens > 0
    ) {
      next.maxContextTokens = spec.maxContextTokens;
    }
    providers[id] = next;
  }
  return { value: providers, warnings };
}

export function parseMcpFile(value: unknown): FileParse<McpServerEntry[]> {
  const warnings: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: [], warnings: ["mcp root must be an object"] };
  }
  const raw = value as Record<string, unknown>;
  noteVersion(raw.version, warnings, "mcp");
  const table = isPlain(raw.mcpServers) ? raw.mcpServers : isPlain(raw.servers) ? raw.servers : {};
  const servers: McpServerEntry[] = [];
  for (const [name, spec] of Object.entries(table)) {
    const parsed = parseMcpServer(name, spec);
    if (!parsed) {
      warnings.push(`mcp server "${name}" needs a command or url`);
      continue;
    }
    servers.push(parsed);
  }
  return { value: servers, warnings };
}

export function parseCronFile(value: unknown): FileParse<CronJob[]> {
  const warnings: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: [], warnings: ["cron jobs root must be an object"] };
  }
  const raw = value as Record<string, unknown>;
  noteVersion(raw.version, warnings, "cron");
  if (!Array.isArray(raw.jobs)) return { value: [], warnings };
  const jobs: CronJob[] = [];
  for (const job of raw.jobs) {
    if (!isPlain(job) || typeof job.id !== "string" || !job.id.trim()) continue;
    const next: CronJob = { id: job.id.trim() };
    if (typeof job.schedule === "string" && job.schedule.trim()) next.schedule = job.schedule.trim();
    if (typeof job.prompt === "string") next.prompt = job.prompt;
    if (typeof job.enabled === "boolean") next.enabled = job.enabled;
    jobs.push(next);
  }
  return { value: jobs, warnings };
}

/** Sparse preference document carrying only keybindings. */
export function keybindingDocument(
  bindings: Record<string, string>,
): MinConfigDocument | undefined {
  if (Object.keys(bindings).length === 0) return undefined;
  return { version: CONFIG_VERSION, ui: { keybindings: bindings } };
}

function parseMcpServer(name: string, value: unknown): McpServerEntry | undefined {
  if (!isPlain(value)) return undefined;
  const url = typeof value.url === "string" ? value.url.trim() : "";
  const command = typeof value.command === "string" ? value.command.trim() : "";
  const transport = value.transport === "sse" || value.transport === "stdio" ? value.transport : undefined;
  if ((transport === "sse" || (!command && url)) && url) {
    return { name, transport: "sse", url };
  }
  if (!command) return undefined;
  const entry: McpServerEntry = { name, transport: "stdio", command };
  if (Array.isArray(value.args)) {
    entry.args = value.args.filter((arg): arg is string => typeof arg === "string");
  }
  if (isPlain(value.env)) entry.env = stringMap(value.env, undefined);
  return entry;
}

function parsePermissions(value: unknown): MinSettings["permissions"] | undefined {
  if (!isPlain(value)) return undefined;
  const out: NonNullable<MinSettings["permissions"]> = {};
  for (const key of ["read", "write", "bash"] as const) {
    const mode = value[key];
    if (typeof mode === "string" && MODES.has(mode as PermissionModeName)) {
      out[key] = mode as PermissionModeName;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseMcpPolicy(value: unknown): MinSettings["mcp"] | undefined {
  if (!isPlain(value)) return undefined;
  if (typeof value.enabled !== "boolean") return undefined;
  return { enabled: value.enabled };
}

function noteVersion(value: unknown, warnings: string[], label: string): void {
  if (value === undefined) return;
  if (typeof value === "number" && Number.isInteger(value) && value > CONFIG_VERSION) {
    warnings.push(`${label} version ${value} is newer than supported ${CONFIG_VERSION}`);
  }
}

function stringMap(value: Record<string, unknown>, skip: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === skip) continue;
    if (typeof entry !== "string") continue;
    out[key] = entry;
  }
  return out;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
