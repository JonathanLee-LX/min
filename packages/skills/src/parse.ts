import matter from "gray-matter";
import type { Skill, SkillMeta } from "./types.js";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ParsedSkillFile {
  meta: Omit<SkillMeta, "uri">;
  body: string;
}

export function parseSkillMarkdown(raw: string): ParsedSkillFile {
  const { data, content } = matter(raw);
  const name = String(data.name ?? "").trim();
  const description = String(data.description ?? "").trim();

  if (!name) throw new Error("SKILL.md missing required frontmatter field: name");
  if (!description) {
    throw new Error("SKILL.md missing required frontmatter field: description");
  }
  if (name.length > 64) throw new Error(`Skill name too long: ${name}`);
  if (!NAME_RE.test(name)) {
    throw new Error(
      `Invalid skill name "${name}": use lowercase letters, numbers, and single hyphens`,
    );
  }
  if (description.length > 1024) {
    throw new Error(`Skill description too long for: ${name}`);
  }

  const meta: Omit<SkillMeta, "uri"> = {
    name,
    description,
  };

  if (data.license != null) meta.license = String(data.license);
  if (data.compatibility != null) meta.compatibility = String(data.compatibility);

  if (data.metadata && typeof data.metadata === "object") {
    meta.metadata = Object.fromEntries(
      Object.entries(data.metadata as Record<string, unknown>).map(([k, v]) => [
        k,
        String(v),
      ]),
    );
  }

  if (data["allowed-tools"] != null) {
    meta.allowedTools = String(data["allowed-tools"])
      .split(/\s+/)
      .filter(Boolean);
  }

  return { meta, body: content.trim() };
}

export function toSkill(
  parsed: ParsedSkillFile,
  uri: string,
  dir?: string,
): Skill {
  return {
    ...parsed.meta,
    uri,
    body: parsed.body,
    dir,
  };
}
