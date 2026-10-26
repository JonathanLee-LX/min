import {
  defineExtension,
  defineTool,
  type Extension,
} from "@min/core";
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
   * on the extension as `.allowedToolsGate` for the host to compose.
   */
  allowedToolsGate?: AllowedToolsGate;
  /**
   * When true (default), pre-approve `allowed-tools` on successful load_skill.
   */
  enforceAllowedTools?: boolean;
}

export type SkillsExtension = Extension & {
  allowedToolsGate: AllowedToolsGate;
};

/**
 * Load Agent Skills (SKILL.md) and expose them to the harness.
 */
export function skills(options: SkillsExtensionOptions = {}): SkillsExtension {
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

  const ext = defineExtension({
    name: "skills",

    async setup(api) {
      const catalog: SkillMeta[] = [];
      for (const source of sources) {
        catalog.push(...(await source.list()));
      }

      if (!catalog.length) return;

      const catalogText = [
        "Available skills (use the load_skill tool to read full instructions when relevant):",
        ...catalog.map((s) => {
          const tools = s.allowedTools?.length
            ? ` [tools: ${s.allowedTools.join(", ")}]`
            : "";
          return `- ${s.name}: ${s.description}${tools}`;
        }),
      ].join("\n");
      api.appendSystem(catalogText);

      if (!registerLoadTool) return;

      api.registerTool(
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
            api.appendSystem(text);
            return { content: text };
          },
        }),
      );
    },
  });

  return Object.assign(ext, { allowedToolsGate });
}
