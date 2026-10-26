import { defineTool, type Tool } from "@min/core";
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

export interface SkillsBundle {
  tools: Tool[];
  allowedToolsGate: AllowedToolsGate;
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
  const loaded = new Set<string>();
  const appendSystem = options.appendSystem ?? (() => {});
  const tools: Tool[] = [];

  const catalog: SkillMeta[] = [];
  for (const source of sources) {
    catalog.push(...(await source.list()));
  }

  if (!catalog.length) {
    return { tools, allowedToolsGate };
  }

  const catalogText = [
    "Available skills (use the load_skill tool to read full instructions when relevant):",
    ...catalog.map((s) => {
      const listed = s.allowedTools?.length
        ? ` [tools: ${s.allowedTools.join(", ")}]`
        : "";
      return `- ${s.name}: ${s.description}${listed}`;
    }),
  ].join("\n");
  appendSystem(catalogText);

  if (registerLoadTool) {
    tools.push(
      defineTool({
        name: loadToolName,
        description:
          "Load the full instructions for a named skill. Call when a skill in the catalog matches the user task.",
        inputSchema: z.object({
          name: z.string().describe("Skill name from the catalog"),
        }),
        async execute({ name }) {
          if (loaded.has(name)) {
            return {
              content: `Skill "${name}" was already loaded in this session.`,
            };
          }

          let skill: Skill | undefined;
          for (const source of sources) {
            try {
              skill = await source.get(name);
              break;
            } catch {
              // try next source
            }
          }

          if (!skill) {
            return { content: `Skill not found: ${name}`, isError: true };
          }

          loaded.add(name);
          if (enforceAllowedTools) {
            allowedToolsGate.activate(skill);
          }

          const allowNote = skill.allowedTools?.length
            ? `\n\n(pre-approved tools: ${skill.allowedTools.join(" ")})`
            : "";
          const text = `# Skill: ${skill.name}\n\n${skill.body}${allowNote}`;
          appendSystem(text);
          return { content: text };
        },
      }),
    );
  }

  return { tools, allowedToolsGate };
}
