import { defineTool, type Tool } from "@min-agent/core";
import { z } from "zod";
import {
  createAllowedToolsGate,
  type AllowedToolsGate,
} from "./allowed-tools.js";
import { filesystemSkillSource } from "./filesystem.js";
import type { Skill, SkillMeta, SkillSource } from "./types.js";

export type { Skill, SkillMeta, SkillSource } from "./types.js";
export { parseSkillMarkdown, toSkill } from "./parse.js";
export { filesystemSkillSource } from "./filesystem.js";
export { discoverSkillDirs, skillDirCandidates } from "./discover.js";
export type { DiscoverSkillDirsOptions } from "./discover.js";
export {
  createAllowedToolsGate,
  type AllowedToolsGate,
} from "./allowed-tools.js";

export interface SkillsExtensionOptions {
  /** Local skill root directories. */
  dirs?: string[];
  /** Additional / alternative sources (e.g. future MCP Skills). */
  sources?: SkillSource[];
  /**
   * When true (default), inject a compact skill catalog into the system prompt
   * and register a `load_skill` tool for progressive disclosure.
   */
  registerLoadTool?: boolean;
  /** Tool name for loading a skill body. Default: load_skill */
  loadToolName?: string;
  /**
   * Shared pre-approval gate. When omitted, one is created and attached
   * on the result as `.allowedToolsGate` for the host to compose.
   */
  allowedToolsGate?: AllowedToolsGate;
  /**
   * When true (default), pre-approve `allowed-tools` on successful load_skill.
   */
  enforceAllowedTools?: boolean;
  /**
   * Receives the catalog at load time and each skill body when `load_skill` runs.
   * The host should re-read its system prompt every model turn.
   */
  appendSystem?: (text: string) => void;
}

export type LoadSkillResult =
  | { ok: true; skill: Skill; alreadyLoaded: boolean }
  | { ok: false; error: string };

export interface SkillsBundle {
  tools: Tool[];
  allowedToolsGate: AllowedToolsGate;
  /** Deduped catalog, later sources win on the same name. */
  catalog: SkillMeta[];
  /** Load a skill body into the system prompt (slash invoke or load_skill). */
  load(name: string): Promise<LoadSkillResult>;
}

/**
 * Load Agent Skills (SKILL.md) and return tools plus a pre-approval gate.
 * System text is delivered through `appendSystem` so a later `load_skill`
 * can extend the prompt without a core extension bus.
 */
export async function skills(
  options: SkillsExtensionOptions = {},
): Promise<SkillsBundle> {
  const sources: SkillSource[] = [...(options.sources ?? [])];
  if (options.dirs?.length) {
    sources.push(filesystemSkillSource({ dirs: options.dirs }));
  }

  const registerLoadTool = options.registerLoadTool !== false;
  const loadToolName = options.loadToolName ?? "load_skill";
  const enforceAllowedTools = options.enforceAllowedTools !== false;
  const allowedToolsGate =
    options.allowedToolsGate ?? createAllowedToolsGate();
  const loaded = new Map<string, Skill>();
  const appendSystem = options.appendSystem ?? (() => {});
  const tools: Tool[] = [];

  const listed: SkillMeta[] = [];
  for (const source of sources) {
    listed.push(...(await source.list()));
  }
  const catalog = mergeByName(listed);

  const load = async (name: string): Promise<LoadSkillResult> => {
    const cached = loaded.get(name);
    if (cached) {
      return { ok: true, skill: cached, alreadyLoaded: true };
    }

    let skill: Skill | undefined;
    for (let i = sources.length - 1; i >= 0; i--) {
      try {
        skill = await sources[i]!.get(name);
        break;
      } catch {
        // try earlier source
      }
    }

    if (!skill) {
      return { ok: false, error: `Skill not found: ${name}` };
    }

    loaded.set(name, skill);
    if (enforceAllowedTools) {
      allowedToolsGate.activate(skill);
    }

    const allowNote = skill.allowedTools?.length
      ? `\n\n(pre-approved tools: ${skill.allowedTools.join(" ")})`
      : "";
    const text = `# Skill: ${skill.name}\n\n${skill.body}${allowNote}`;
    appendSystem(text);
    return { ok: true, skill, alreadyLoaded: false };
  };

  if (!catalog.length) {
    return { tools, allowedToolsGate, catalog, load };
  }

  const catalogText = [
    "Available skills (invoke with /name, or use load_skill when relevant):",
    ...catalog.map((s) => {
      const listedTools = s.allowedTools?.length
        ? ` [tools: ${s.allowedTools.join(", ")}]`
        : "";
      return `- ${s.name}: ${s.description}${listedTools}`;
    }),
  ].join("\n");
  appendSystem(catalogText);

  if (registerLoadTool) {
    tools.push(
      defineTool({
        name: loadToolName,
        description:
          "Load the full instructions for a named skill. Call when a skill in the catalog matches the user task. Skip when the user already invoked /name.",
        inputSchema: z.object({
          name: z.string().describe("Skill name from the catalog"),
        }),
        async execute({ name }) {
          const result = await load(name);
          if (!result.ok) {
            return { content: result.error, isError: true };
          }
          if (result.alreadyLoaded) {
            return {
              content: `Skill "${name}" was already loaded in this session.`,
            };
          }
          const allowNote = result.skill.allowedTools?.length
            ? `\n\n(pre-approved tools: ${result.skill.allowedTools.join(" ")})`
            : "";
          return {
            content: `# Skill: ${result.skill.name}\n\n${result.skill.body}${allowNote}`,
          };
        },
      }),
    );
  }

  return { tools, allowedToolsGate, catalog, load };
}

function mergeByName(items: SkillMeta[]): SkillMeta[] {
  const map = new Map<string, SkillMeta>();
  for (const item of items) map.set(item.name, item);
  return [...map.values()];
}
