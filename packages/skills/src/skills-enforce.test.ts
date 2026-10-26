import { createAgent, defineTool, mockProvider } from "@min/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
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

const bash = defineTool({
  name: "bash",
  description: "run",
  inputSchema: z.object({ command: z.string() }),
  async execute() {
    return { content: "ran" };
  },
});

describe("skills allowed-tools pre-approval", () => {
  it("does not block tools omitted from allowed-tools", async () => {
    const gate = createAllowedToolsGate();
    const skill: Skill = {
      name: "ro",
      description: "read only",
      uri: "memory:ro",
      body: "Prefer read_file.",
      allowedTools: ["read_file", "glob"],
    };

    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [{ name: "load_skill", arguments: { name: "ro" } }],
        },
        {
          toolCalls: [{ name: "bash", arguments: { command: "echo hi" } }],
        },
        { text: "done" },
      ]),
      tools: [bash],
      extensions: [
        skills({ sources: [memorySource(skill)], allowedToolsGate: gate }),
      ],
      permissionHandler: gate.wrap(async (ctx) => {
        if (ctx.toolCall.name === "load_skill") return { action: "allow" };
        return { action: "ask", reason: "confirm bash" };
      }),
    });

    const asks: string[] = [];
    await agent.run({
      input: "use the skill then bash",
      onEvent(e) {
        if (e.type === "permission" && e.decision === "ask") {
          asks.push(e.toolCall.name);
        }
      },
    });

    expect([...gate.preapproved()].sort()).toEqual(["glob", "read_file"]);
    expect(asks).toEqual(["bash"]);
    await agent.dispose();
  });

  it("runs a pre-approved tool without prompting", async () => {
    const gate = createAllowedToolsGate();
    const skill: Skill = {
      name: "shell",
      description: "shell",
      uri: "memory:shell",
      body: "Use bash.",
      allowedTools: ["bash"],
    };

    const agent = await createAgent({
      provider: mockProvider([
        {
          toolCalls: [{ name: "load_skill", arguments: { name: "shell" } }],
        },
        {
          toolCalls: [{ name: "bash", arguments: { command: "echo hi" } }],
        },
        { text: "done" },
      ]),
      tools: [bash],
      extensions: [
        skills({ sources: [memorySource(skill)], allowedToolsGate: gate }),
      ],
      permissionHandler: gate.wrap(async (ctx) => {
        if (ctx.toolCall.name === "load_skill") return { action: "allow" };
        return { action: "ask", reason: "confirm bash" };
      }),
    });

    const asks: string[] = [];
    const result = await agent.run({
      input: "load then bash",
      onEvent(e) {
        if (e.type === "permission" && e.decision === "ask") {
          asks.push(e.toolCall.name);
        }
      },
    });

    expect(asks).toEqual([]);
    expect(result.messages.some((m) => m.role === "tool")).toBe(true);
    await agent.dispose();
  });
});
