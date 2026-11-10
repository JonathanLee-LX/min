import { formatContextUsageReport, type MinClient } from "@min-agent/client";
import {
  modelSupportsEffort,
  parseReasoningEffort,
  type ModelControls,
} from "@min-agent/runtime";
import {
  effectiveMaxContextTokens,
  modelIdFromProviderId,
  type ProviderSpec,
} from "@min-agent/config";
import {
  buildModelPickerItems,
  formatCompact,
  formatHelp,
  formatModelStatus,
  formatQueue,
  formatSession,
  formatSessionList,
  resolveModelArgs,
  type Command,
  type EffortPickValue,
  type ModelPickItem,
  type NamedProviderSpec,
} from "../shared/commands.js";
import type { ModelRow } from "../shared/types.js";

export interface CommandResult {
  level?: "sys" | "error";
  message?: string;
  picker?: "sessions" | "models";
  toggle?: "thinking";
}

export interface CommandHost {
  versionLine: string;
  providers: Readonly<Record<string, NamedProviderSpec>>;
  controls: ModelControls | null;
  client: Pick<
    MinClient,
    | "getStatus"
    | "getSession"
    | "queue"
    | "listSessions"
    | "openSession"
    | "newSession"
    | "reset"
    | "renameSession"
    | "generateSessionTitle"
    | "compact"
    | "setMaxContextTokens"
    | "listSkills"
  >;
  runtime: {
    maxContextTokens?: number;
    modelContextTokens?: Record<string, number>;
  };
}

export async function executeCommand(host: CommandHost, command: Command): Promise<CommandResult> {
  if (command.type === "exit") {
    return { level: "sys", message: "Close this tab to leave min-web." };
  }
  if (command.type === "help") {
    return { level: "sys", message: formatHelp(host.client.listSkills()) };
  }
  if (command.type === "thinking") return { toggle: "thinking" };
  if (command.type === "context") {
    return { level: "sys", message: formatContextUsageReport(host.client.getStatus().context) };
  }
  if (command.type === "version") return { level: "sys", message: host.versionLine };
  if (command.type === "session") {
    const session = host.client.getSession();
    const status = host.client.getStatus();
    return {
      level: "sys",
      message: formatSession({
        id: session.id,
        title: session.title,
        messageCount: session.messageCount,
        provider: status.provider,
        queueSize: host.client.queue.size,
      }),
    };
  }
  if (command.type === "sessions") {
    const metas = await host.client.listSessions();
    return {
      level: "sys",
      message: formatSessionList(metas, host.client.getSession().id),
      picker: "sessions",
    };
  }
  if (command.type === "resume-pick") return { picker: "sessions" };
  if (command.type === "resume") {
    await host.client.openSession(command.id);
    return { level: "sys", message: `resumed ${host.client.getSession().id}` };
  }
  if (command.type === "new") {
    await host.client.newSession();
    return { level: "sys", message: `new session ${host.client.getSession().id}` };
  }
  if (command.type === "compact") {
    return { level: "sys", message: formatCompact(await host.client.compact()) };
  }
  if (command.type === "reset") {
    host.client.reset();
    return { level: "sys", message: "history cleared" };
  }
  if (command.type === "queue") {
    return { level: "sys", message: formatQueue(host.client.queue.peek()) };
  }
  if (command.type === "dense-usage") {
    return { level: "sys", message: "usage: /dense <text>  — queue as dense-latest supplement" };
  }
  if (command.type === "dense") {
    host.client.queue.push(command.text, { mode: "dense-latest" });
    return { level: "sys", message: `queued dense-latest (size=${host.client.queue.size})` };
  }
  if (command.type === "name") {
    const title = await host.client.generateSessionTitle();
    return { level: "sys", message: `name ${title}` };
  }
  if (command.type === "name-set") {
    await host.client.renameSession(command.title);
    return { level: "sys", message: `name ${host.client.getSession().title ?? command.title}` };
  }
  if (command.type === "effort" || command.type === "effort-set") {
    return applyEffort(host, command.type === "effort-set" ? command.value : undefined);
  }
  if (command.type === "model-pick" || command.type === "model-set") {
    return applyModelCommand(host, command);
  }
  return { level: "error", message: "unsupported command" };
}

export function modelRows(host: CommandHost): ModelRow[] {
  const controls = host.controls;
  if (!controls) return [];
  return buildModelPickerItems(
    controls.selection(),
    controls.models(),
    host.providers,
    modelSupportsEffort,
  ).map(toRow);
}

export function selectModel(
  host: CommandHost,
  key: string,
  effort?: string,
): CommandResult {
  const controls = host.controls;
  if (!controls) return { level: "error", message: "model controls are unavailable" };
  const items = buildModelPickerItems(
    controls.selection(),
    controls.models(),
    host.providers,
    modelSupportsEffort,
  );
  const item = items.find((candidate) => candidate.key === key);
  if (!item) return { level: "error", message: `unknown model: ${key}` };
  const parsed = effort ? parseEffort(effort) : undefined;
  if (effort && !parsed) {
    return {
      level: "error",
      message: "effort must be none, low, medium, high, max, or default",
    };
  }
  applyModelChange(
    host,
    controls,
    item.change,
    parsed,
    item.key.startsWith("saved:") ? toProviderSpec(host.providers[item.name]) : undefined,
  );
  return { level: "sys", message: modelStatus(host) };
}

function applyEffort(host: CommandHost, value: string | undefined): CommandResult {
  const controls = host.controls;
  if (!controls) return { level: "error", message: "model controls are unavailable" };
  if (value !== undefined) {
    const parsed = parseEffort(value);
    if (!parsed) {
      return {
        level: "error",
        message: "effort must be none, low, medium, high, max, or default",
      };
    }
    controls.setEffort(parsed === "default" ? undefined : parseReasoningEffort(parsed));
  }
  const selected = controls.selection();
  return { level: "sys", message: `effort ${selected.effort ?? "(default)"}` };
}

function applyModelCommand(
  host: CommandHost,
  command: Extract<Command, { type: "model-pick" | "model-set" }>,
): CommandResult {
  const controls = host.controls;
  if (!controls) return { level: "error", message: "model controls are unavailable" };
  if (command.type === "model-pick") {
    const items = buildModelPickerItems(
      controls.selection(),
      controls.models(),
      host.providers,
      modelSupportsEffort,
    );
    if (items.length === 0) return { level: "sys", message: modelStatus(host) };
    return { picker: "models" };
  }
  const change = resolveModelArgs(command.args, host.providers);
  if (change.type === "error") return { level: "error", message: change.message };
  if (change.type !== "show") {
    const saved =
      command.type === "model-set" && command.args.length === 1
        ? toProviderSpec(host.providers[command.args[0] ?? ""])
        : undefined;
    applyModelChange(host, controls, change, undefined, saved);
  }
  return { level: "sys", message: modelStatus(host) };
}

function toProviderSpec(spec: NamedProviderSpec | undefined): ProviderSpec | undefined {
  if (!spec) return undefined;
  return {
    kind: spec.kind,
    ...(spec.model ? { model: spec.model } : {}),
    ...(spec.baseUrl ? { baseUrl: spec.baseUrl } : {}),
    ...(spec.apiKeyEnv ? { apiKeyEnv: spec.apiKeyEnv } : {}),
    ...(spec.maxContextTokens ? { maxContextTokens: spec.maxContextTokens } : {}),
  };
}

function applyModelChange(
  host: CommandHost,
  controls: ModelControls,
  change: ModelPickItem["change"],
  effort?: EffortPickValue,
  providerSpec?: ProviderSpec,
): void {
  if (change.type === "model") controls.setModel(change.model);
  if (change.type === "provider") {
    controls.setProvider({
      kind: change.kind,
      model: change.model,
      baseURL: change.baseURL,
      apiKey: change.apiKey,
    });
  }
  if (effort === "default") {
    controls.setEffort(undefined);
  } else if (effort) {
    const parsed = parseReasoningEffort(effort);
    if (parsed) controls.setEffort(parsed);
  }
  const model =
    controls.selection().model || modelIdFromProviderId(host.client.getStatus().provider);
  const tokens = effectiveMaxContextTokens({
    model,
    modelContextTokens: host.runtime.modelContextTokens,
    providerSpec,
    global: host.runtime.maxContextTokens,
  });
  host.client.setMaxContextTokens(tokens);
}

function parseEffort(value: string): EffortPickValue | undefined {
  const name = value.trim().toLowerCase();
  if (
    name === "none" ||
    name === "low" ||
    name === "medium" ||
    name === "high" ||
    name === "max" ||
    name === "default"
  ) {
    return name;
  }
  return undefined;
}

function modelStatus(host: CommandHost): string {
  const controls = host.controls;
  if (!controls) return "model controls are unavailable";
  const selected = controls.selection();
  return formatModelStatus({
    kind: selected.kind,
    model: selected.model,
    effort: selected.effort,
    models: controls.models(),
    saved: Object.keys(host.providers),
  });
}

function toRow(item: ModelPickItem): ModelRow {
  return {
    key: item.key,
    name: item.name,
    detail: item.detail,
    current: item.current,
    supportsEffort: item.supportsEffort,
  };
}
