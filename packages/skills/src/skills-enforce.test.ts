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
  it("asks (then denies without approver) for tools outside the allowlist", async () => {
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
      permissionHandler: gate.wrap(async () => ({ action: "allow" })),
    });

    const asks: string[] = [];
    const toolErrors: string[] = [];
    await agent.run({
      input: "use the skill then bash",
      onEvent(e) {
        if (e.type === "permission" && e.decision === "ask") {
          asks.push(e.toolCall.name);
        }
        if (e.type === "tool_result" && e.isError) {
          toolErrors.push(e.content);
        }
      },
    });

    expect(gate.activeAllowlist()).toEqual(new Set(["read_file", "glob"]));
    expect(asks).toContain("bash");
    expect(toolErrors.some((c) => c.includes("no interactive approver"))).toBe(
      true,
    );
    await agent.dispose();
  });

  it("runs the tool after onPermissionAsk allow, and persists allow_session via grantSession", async () => {
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
        {
          toolCalls: [{ name: "bash", arguments: { command: "echo again" } }],
        },
        { text: "done" },
      ]),
      extensions: [
        skills({ sources: [memorySource(skill)], allowedToolsGate: gate }),
      ],
      permissionHandler: gate.wrap(async () => ({ action: "allow" })),
    });

    let asks = 0;
    await agent.run({
      input: "load then bash twice",
      async onPermissionAsk(req) {
        asks += 1;
        if (asks === 1) {
          gate.grantSession(req.toolCall.name);
          return "allow_session";
        }
        throw new Error("should not ask again after grantSession");
      },
    });

    expect(asks).toBe(1);
    expect([...gate.sessionGrants()]).toEqual(["bash"]);
    await agent.dispose();
  });
});
