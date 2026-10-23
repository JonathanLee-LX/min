import { createAgent, mockProvider } from "@min/core";
import { describe, expect, it } from "vitest";
import { createAllowedToolsGate, skills } from "./index.js";
import type { Skill, SkillSource } from "./types.js";

function memorySource(skill: Skill): SkillSource {
  return {
    id: "memory",
    async list() {
      return [skill];
    },
    async get(name) {
      if (name !== skill.name) throw new Error("missing");
      return skill;
    },
  };
}

describe("skills allowed-tools enforcement", () => {
  it("denies tools outside the loaded skill allowlist", async () => {
    const gate = createAllowedToolsGate();
    const skill: Skill = {
      name: "ro",
      description: "read only",
      uri: "memory:ro",
      body: "Only read files.",
      allowedTools: ["read_file", "glob"],
    };

    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [
            { name: "load_skill", arguments: { name: "ro" } },
          ],
        },
        {
          toolCalls: [{ name: "bash", arguments: { command: "echo hi" } }],
        },
        { text: "done" },
      ]),
      extensions: [
        skills({ sources: [memorySource(skill)], allowedToolsGate: gate }),
      ],
      // No workspace tools — bash is unknown; permission still runs before execute.
      permissionHandler: gate.wrap(async () => ({ action: "allow" })),
    });

    const denials: string[] = [];
    await agent.run({
      input: "use the skill then bash",
      onEvent(e) {
        if (e.type === "permission" && e.decision === "deny") {
          denials.push(e.toolCall.name);
        }
      },
    });

    expect(gate.activeAllowlist()).toEqual(new Set(["read_file", "glob"]));
    expect(denials).toContain("bash");
    await agent.dispose();
  });
});
