import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filesystemSkillSource } from "./filesystem.js";
import { parseSkillMarkdown } from "./parse.js";

describe("parseSkillMarkdown", () => {
  it("parses valid frontmatter", () => {
    const parsed = parseSkillMarkdown(`---
name: pdf-processing
description: Extract text from PDFs. Use when handling PDF files.
license: Apache-2.0
metadata:
  author: min
allowed-tools: read_file write_file
---

# PDF

Do the thing.
`);
    expect(parsed.meta.name).toBe("pdf-processing");
    expect(parsed.meta.allowedTools).toEqual(["read_file", "write_file"]);
    expect(parsed.body).toContain("Do the thing.");
  });

  it("rejects invalid names", () => {
    expect(() =>
      parseSkillMarkdown(`---
name: PDF
description: bad
---
`),
    ).toThrow(/Invalid skill name/);
  });
});

describe("filesystemSkillSource", () => {
  it("discovers skills and loads bodies on demand", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-skills-"));
    const skillDir = path.join(root, "greeter");
    await mkdir(skillDir);
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: greeter
description: Friendly greetings. Use when saying hello.
---

Say hi briefly.
`,
      "utf8",
    );

    const source = filesystemSkillSource({ dirs: [root] });
    const list = await source.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("greeter");

    const skill = await source.get("greeter");
    expect(skill.body).toContain("Say hi briefly.");
  });
});
