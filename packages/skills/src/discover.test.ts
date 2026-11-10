import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSkillDirs, skillDirCandidates } from "./discover.js";
import { filesystemSkillSource } from "./filesystem.js";

function writeSkill(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`,
  );
}

describe("discoverSkillDirs", () => {
  it("lists foreign dirs before min dirs", () => {
    const home = "/home/me";
    const cwd = "/work/app";
    const dirs = skillDirCandidates({ cwd, home, env: {} });
    expect(dirs).toEqual([
      path.join(home, ".agents", "skills"),
      path.join(home, ".codex", "skills"),
      path.join(home, ".claude", "skills"),
      path.join(home, ".cursor", "skills"),
      path.join(cwd, ".agents", "skills"),
      path.join(cwd, ".codex", "skills"),
      path.join(cwd, ".claude", "skills"),
      path.join(cwd, ".cursor", "skills"),
      path.join(home, ".min", "skills"),
      path.join(cwd, ".min", "skills"),
      path.join(cwd, "skills"),
    ]);
  });

  it("lets a later min skill replace a Claude skill of the same name", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "min-skill-compat-"));
    const home = path.join(root, "home");
    const cwd = path.join(root, "repo");
    writeSkill(path.join(home, ".claude", "skills", "greeter"), "greeter", "from claude");
    writeSkill(path.join(cwd, ".min", "skills", "greeter"), "greeter", "from min");
    writeSkill(path.join(cwd, ".cursor", "skills", "cursor-only"), "cursor-only", "from cursor");

    const dirs = discoverSkillDirs({ cwd, home, env: {} });
    const source = filesystemSkillSource({ dirs });
    const listed = await source.list();
    expect(listed.map((skill) => skill.name).sort()).toEqual(["cursor-only", "greeter"]);
    expect((await source.get("greeter")).body).toContain("from min");
    expect((await source.get("cursor-only")).body).toContain("from cursor");
  });
});
