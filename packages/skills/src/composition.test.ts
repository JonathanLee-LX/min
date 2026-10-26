import { createAgent, defineTool, mockProvider } from "@min-agent/core";
import { createPermissionGate } from "@min-agent/tools";
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

describe("skills composition contracts", () => {
  it("grows appendSystem on catalog load and again on load_skill", async () => {
    const chunks: string[] = [];
    const skill: Skill = {
      name: "demo",
      description: "Demo skill",
      uri: "memory:demo",
      body: "Do the demo carefully.",
      allowedTools: ["read_file"],
    };
    const bundle = await skills({
      sources: [memorySource(skill)],
      appendSystem(text) {
        chunks.push(text);
      },
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("Available skills");
    expect(chunks[0]).toContain("demo");

    const load = bundle.tools.find((tool) => tool.name === "load_skill");
    expect(load).toBeDefined();
    const result = await load!.execute({ name: "demo" }, {});
    expect(result.isError).toBeFalsy();
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toContain("# Skill: demo");
    expect(chunks[1]).toContain("Do the demo carefully.");
    expect([...bundle.allowedToolsGate.preapproved()]).toEqual(["read_file"]);
  });

  it("pre-approves frontmatter tools while non-listed tools still ask", async () => {
    const gate = createAllowedToolsGate();
    const skill: Skill = {
      name: "reader",
      description: "read",
      uri: "memory:reader",
      body: "Prefer read_file.",
      allowedTools: ["read_file"],
    };
    const loaded = await skills({
      sources: [memorySource(skill)],
      allowedToolsGate: gate,
    });
    const asks: string[] = [];
    const permission = createPermissionGate(
      gate.wrap(async (ctx) => {
        if (ctx.toolCall.name === "load_skill") return { action: "allow" };
        if (ctx.toolCall.name === "read_file") {
          return { action: "ask", reason: "should be preapproved" };
        }
        return { action: "ask", reason: "confirm bash" };
      }),
    );
    permission.setAsk(async (req) => {
      asks.push(req.toolCall.name);
      return "deny";
    });

    const readFile = defineTool({
      name: "read_file",
      description: "read",
      inputSchema: z.object({ path: z.string() }),
      async execute() {
        return { content: "ok" };
      },
    });
    const bash = defineTool({
      name: "bash",
      description: "run",
      inputSchema: z.object({ command: z.string() }),
      async execute() {
        return { content: "ran" };
      },
    });

    const agent = await createAgent({
      provider: mockProvider([
        { toolCalls: [{ name: "load_skill", arguments: { name: "reader" } }] },
        { toolCalls: [{ name: "read_file", arguments: { path: "a.txt" } }] },
        { toolCalls: [{ name: "bash", arguments: { command: "echo hi" } }] },
        { text: "done" },
      ]),
      tools: permission.wrap([readFile, bash, ...loaded.tools]),
    });

    await agent.run("use skill");
    expect([...gate.preapproved()]).toEqual(["read_file"]);
    expect(asks).toEqual(["bash"]);
    await agent.dispose();
  });
});
