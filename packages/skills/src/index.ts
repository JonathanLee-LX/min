import {
  defineExtension,
  defineTool,
  type Extension,
} from "@min/core";
import { z } from "zod";
import { filesystemSkillSource } from "./filesystem.js";
import type { Skill, SkillMeta, SkillSource } from "./types.js";

export type { Skill, SkillMeta, SkillSource } from "./types.js";
export { parseSkillMarkdown, toSkill } from "./parse.js";
export { filesystemSkillSource } from "./filesystem.js";

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
}

/**
 * Load Agent Skills (SKILL.md) and expose them to the harness.
 */
export function skills(options: SkillsExtensionOptions = {}): Extension {
  const sources: SkillSource[] = [...(options.sources ?? [])];
  if (options.dirs?.length) {
    sources.push(filesystemSkillSource({ dirs: options.dirs }));
  }

  const registerLoadTool = options.registerLoadTool !== false;
  const loadToolName = options.loadToolName ?? "load_skill";
  const loaded = new Set<string>();

  return defineExtension({
    name: "skills",

    async setup(api) {
      const catalog: SkillMeta[] = [];
      for (const source of sources) {
        catalog.push(...(await source.list()));
      }

      if (!catalog.length) return;

      const catalogText = [
        "Available skills (use the load_skill tool to read full instructions when relevant):",
        ...catalog.map((s) => `- ${s.name}: ${s.description}`),
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
            const text = `# Skill: ${skill.name}\n\n${skill.body}`;
            // Also append to system for subsequent turns
            api.appendSystem(text);
            return { content: text };
          },
        }),
      );
    },
  });
}
