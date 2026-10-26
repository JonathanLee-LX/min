import { createAgent, defineTool, mockProvider } from "@min/core";
import { createPermissionGate } from "@min/tools";
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

    const loaded = await skills({
      sources: [memorySource(skill)],
      allowedToolsGate: gate,
    });
    const gateTools = createPermissionGate(
      gate.wrap(async (ctx) => {
        if (ctx.toolCall.name === "load_skill") return { action: "allow" };
        return { action: "ask", reason: "confirm bash" };
      }),
    );
    const asks: string[] = [];
    gateTools.setAsk(async (req) => {
      asks.push(req.toolCall.name);
      return "deny";
    });

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
      tools: gateTools.wrap([bash, ...loaded.tools]),
    });

    await agent.run("use the skill then bash");

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

    const loaded = await skills({
      sources: [memorySource(skill)],
      allowedToolsGate: gate,
    });
    const gateTools = createPermissionGate(
      gate.wrap(async (ctx) => {
        if (ctx.toolCall.name === "load_skill") return { action: "allow" };
        return { action: "ask", reason: "confirm bash" };
      }),
    );
    const asks: string[] = [];
    gateTools.setAsk(async (req) => {
      asks.push(req.toolCall.name);
      return "deny";
    });

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
      tools: gateTools.wrap([bash, ...loaded.tools]),
    });

    const result = await agent.run("load then bash");

    expect(asks).toEqual([]);
    expect(result.messages.some((m) => m.role === "tool")).toBe(true);
    await agent.dispose();
  });
});
