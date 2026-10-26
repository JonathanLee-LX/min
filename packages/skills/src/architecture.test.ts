import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAllowedToolsGate } from "./allowed-tools.js";
import { filesystemSkillSource } from "./filesystem.js";
import { skills } from "./index.js";

describe("skills architecture contracts", () => {
  it("discovers SKILL.md outside the core runner", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-skill-arch-"));
    const dir = path.join(root, "demo");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SKILL.md"),
      [
        "---",
        "name: demo",
        "description: Demo skill",
        "allowed-tools: read_file",
        "---",
        "",
        "Do the demo.",
        "",
      ].join("\n"),
    );
    const source = filesystemSkillSource({ dirs: [root] });
    const listed = await source.list();
    expect(listed.map((skill) => skill.name)).toContain("demo");
    expect(listed.find((skill) => skill.name === "demo")?.allowedTools).toContain(
      "read_file",
    );

    const bundle = await skills({ dirs: [root] });
    expect(bundle.tools.some((tool) => tool.name === "load_skill")).toBe(true);
    expect(bundle.allowedToolsGate).toBeDefined();
  });

  it("pre-approves only names from allowed-tools", () => {
    const gate = createAllowedToolsGate();
    gate.activate({ name: "writer", allowedTools: ["write_file"] });
    expect(gate.preapproved().has("write_file")).toBe(true);
    expect(gate.preapproved().has("bash")).toBe(false);
  });
});
