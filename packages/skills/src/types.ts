/**
 * Skill source abstraction — filesystem today; MCP Skills Extension later.
 */
export interface SkillMeta {
  name: string;
  description: string;
  /** Absolute or logical URI for progressive loading. */
  uri: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
}

export interface Skill extends SkillMeta {
  /** Full SKILL.md body (markdown after frontmatter). Loaded on demand. */
  body: string;
  /** Directory containing the skill (if filesystem-backed). */
  dir?: string;
}

export interface SkillSource {
  readonly id: string;
  /** Discover skills — metadata only (progressive disclosure). */
  list(): Promise<SkillMeta[]>;
  /** Load full skill content by name or uri. */
  get(nameOrUri: string): Promise<Skill>;
}
