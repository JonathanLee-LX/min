import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mockProvider, type RunEvent } from "@min/core";
import { describe, expect, it } from "vitest";
import { createRuntime } from "./runtime.js";

describe("createRuntime", () => {
  it("boots with mock provider and no tools", async () => {
    const rt = await createRuntime({
      cwd: process.cwd(),
      provider: mockProvider([{ text: "ok" }]),
      noTools: true,
      noSessionStore: true,
    });
    expect(rt.contextStrategy).toBe("trim");
    const result = await rt.session.run("hi");
    expect(result.text).toBe("ok");
    await rt.session.dispose();
    await rt.agent.dispose();
  });

  it("defaults to hybrid when tools are enabled", async () => {
    const rt = await createRuntime({
      cwd: process.cwd(),
      provider: mockProvider([{ text: "ok" }]),
      noSessionStore: true,
    });
    expect(rt.contextStrategy).toBe("hybrid");
    expect(rt.session.stash).toBeDefined();
    await rt.session.dispose();
    await rt.agent.dispose();
  });

  it("honors an explicit contextStrategy override", async () => {
    const rt = await createRuntime({
      cwd: process.cwd(),
      provider: mockProvider([{ text: "ok" }]),
      noSessionStore: true,
      contextStrategy: "trim",
    });
    expect(rt.contextStrategy).toBe("trim");
    await rt.session.dispose();
    await rt.agent.dispose();
  });

  it("pre-approves skill tools and still asks for the rest", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "min-skill-"));
    const skillDir = path.join(cwd, "skills", "writer");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: writer",
        "description: Write a note inside the workspace.",
        "allowed-tools: write_file",
        "---",
        "",
        "Write note.txt.",
        "",
      ].join("\n"),
    );

    const outside = path.join(cwd, "..", "min-skill-outside.txt");
    const rt = await createRuntime({
      cwd,
      provider: mockProvider([
        { toolCalls: [{ name: "load_skill", arguments: { name: "writer" } }] },
        {
          toolCalls: [
            {
              name: "write_file",
              arguments: { path: "note.txt", content: "hello" },
            },
          ],
        },
        {
          toolCalls: [
            { name: "bash", arguments: { command: "python3 -c 'print(1)'" } },
          ],
        },
        {
          toolCalls: [
            {
              name: "write_file",
              arguments: { path: outside, content: "nope" },
            },
          ],
        },
        { text: "done" },
      ]),
      noSessionStore: true,
      skillsDir: path.join(cwd, "skills"),
      askWrite: true,
    });

    const asks: Array<{ name: string; grantRoot?: string }> = [];
    let lastTool = "";
    const results: Array<{ name: string; error: boolean; content: string }> =
      [];

    await rt.session.run("exercise the skill", {
      onEvent(event: RunEvent) {
        if (event.type === "tool_call") lastTool = event.toolCall.name;
        if (event.type === "tool_result") {
          results.push({
            name: lastTool,
            error: Boolean(event.isError),
            content: event.content,
          });
        }
      },
      async onPermissionAsk(req) {
        asks.push({ name: req.toolCall.name, grantRoot: req.grantRoot });
        return "deny";
      },
    });

    expect([...rt.allowedToolsGate.preapproved()]).toEqual(["write_file"]);
    expect(
      results.some(
        (r) => r.name === "write_file" && !r.error && r.content.includes("Wrote"),
      ),
    ).toBe(true);
    expect(asks.map((a) => a.name)).toEqual(["bash", "write_file"]);
    expect(asks[1]?.grantRoot).toBeTruthy();

    const plain = await createRuntime({
      cwd,
      provider: mockProvider([
        {
          toolCalls: [
            {
              name: "write_file",
              arguments: { path: "other.txt", content: "x" },
            },
          ],
        },
        { text: "done" },
      ]),
      noSessionStore: true,
      skillsDir: path.join(cwd, "skills"),
      askWrite: true,
    });
    const plainAsks: string[] = [];
    await plain.session.run("write without loading the skill", {
      async onPermissionAsk(req) {
        plainAsks.push(req.toolCall.name);
        return "deny";
      },
    });
    expect(plainAsks).toEqual(["write_file"]);

    await rt.session.dispose();
    await rt.agent.dispose();
    await plain.session.dispose();
    await plain.agent.dispose();
  });
});
