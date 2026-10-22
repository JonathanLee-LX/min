import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseSkillMarkdown, toSkill } from "./parse.js";
import type { Skill, SkillMeta, SkillSource } from "./types.js";

export interface FilesystemSkillSourceOptions {
  /** Directories that contain skill folders (each with SKILL.md). */
  dirs: string[];
}

/**
 * Discover Agent Skills from local directories.
 * Layout: `{dirs}/{skill-name}/SKILL.md`
 */
export function filesystemSkillSource(
  options: FilesystemSkillSourceOptions,
): SkillSource {
  const cache = new Map<string, Skill>();

  async function scan(): Promise<Skill[]> {
    if (cache.size) return [...cache.values()];

    for (const dir of options.dirs) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = path.join(dir, entry.name);
        const skillFile = path.join(skillDir, "SKILL.md");
        try {
          const st = await stat(skillFile);
          if (!st.isFile()) continue;
        } catch {
          continue;
        }

        const raw = await readFile(skillFile, "utf8");
        const parsed = parseSkillMarkdown(raw);
        if (parsed.meta.name !== entry.name) {
          throw new Error(
            `Skill name "${parsed.meta.name}" must match directory "${entry.name}"`,
          );
        }
        const uri = `skill://filesystem/${parsed.meta.name}/SKILL.md`;
        const skill = toSkill(parsed, uri, skillDir);
        cache.set(skill.name, skill);
        cache.set(uri, skill);
      }
    }

    return [...new Map([...cache.values()].map((s) => [s.name, s])).values()];
  }

  return {
    id: "filesystem",

    async list(): Promise<SkillMeta[]> {
      const skills = await scan();
      return skills.map(({ body: _b, dir: _d, ...meta }) => meta);
    },

    async get(nameOrUri: string): Promise<Skill> {
      await scan();
      const skill = cache.get(nameOrUri);
      if (!skill) {
        throw new Error(`Skill not found: ${nameOrUri}`);
      }
      return skill;
    },
  };
}
