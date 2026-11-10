import matter from "gray-matter";
import type { Skill, SkillMeta } from "./types.js";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ParsedSkillFile {
  meta: Omit<SkillMeta, "uri">;
  body: string;
}

export interface ParseSkillOptions {
  /** Used when frontmatter omits `name`, or the name is not a valid skill id. */
  fallbackName?: string;
}

export function parseSkillMarkdown(
  raw: string,
  options: ParseSkillOptions = {},
): ParsedSkillFile {
  const { data, content } = matter(raw);
  const fallback = slugifySkillName(options.fallbackName ?? "");
  let name = String(data.name ?? "").trim();
  if (name && !NAME_RE.test(name)) {
    if (fallback && NAME_RE.test(fallback)) name = fallback;
    else {
      throw new Error(
        `Invalid skill name "${name}": use lowercase letters, numbers, and single hyphens`,
      );
    }
  }
  if (!name) name = fallback;
  const description = String(data.description ?? "").trim() || (name ? `Agent skill ${name}.` : "");

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

  const allowedTools = readAllowedTools(data["allowed-tools"]);
  if (allowedTools?.length) meta.allowedTools = allowedTools;

  return { meta, body: content.trim() };
}

/** Directory names → skill ids: `PDF Processing` → `pdf-processing`. */
export function slugifySkillName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function readAllowedTools(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  const parts = Array.isArray(value) ? value : [value];
  return parts
    .flatMap((entry) => String(entry).split(/\s+/))
    .map((entry) => entry.trim())
    .filter(Boolean);
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
