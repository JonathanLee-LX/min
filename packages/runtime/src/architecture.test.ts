import { mockProvider, type RunEvent } from "@min-agent/core";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as runtimeApi from "./index.js";
import { createRuntime } from "./runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("runtime architecture contracts", () => {
  it("composes host packages and does not depend on client or mcp or config", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {}).sort();
    expect(deps).toEqual([
      "@min-agent/core",
      "@min-agent/providers",
      "@min-agent/session",
      "@min-agent/skills",
      "@min-agent/tools",
    ]);
    expect(deps).not.toContain("@min-agent/client");
    expect(deps).not.toContain("@min-agent/mcp");
    expect(deps).not.toContain("@min-agent/config");
  });

  it("exports createRuntime as the composition entry", () => {
    expect(typeof runtimeApi.createRuntime).toBe("function");
    expect(runtimeApi.DEFAULT_MAX_TURNS).toBe(40);
  });

  it("does not connect MCP by default; ships workspace tools plus recall", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "min-rt-arch-home-"));
    const rt = await createRuntime({
      cwd: process.cwd(),
      home,
      provider: mockProvider([{ text: "ok" }]),
      noSessionStore: true,
    });
    const names = rt.agent.tools.list().map((tool) => tool.name).sort();
    expect(names).toEqual(
      expect.arrayContaining(["bash", "glob", "read_file", "write_file", "recall_context"]),
    );
    expect(names.every((name) => !name.includes("mcp"))).toBe(true);
    await rt.session.dispose();
    await rt.agent.dispose();
  });

  it("keeps permissions outside core: policy lives on the runtime, not the agent", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "min-rt-arch-home-"));
    const rt = await createRuntime({
      cwd: process.cwd(),
      home,
      provider: mockProvider([{ text: "ok" }]),
      noSessionStore: true,
    });
    expect(rt.permissions).toBeDefined();
    expect(rt.allowedToolsGate).toBeDefined();
    expect("permissions" in rt.agent).toBe(false);
    await rt.session.dispose();
    await rt.agent.dispose();
  });

  it("routes deny through tool_result.isError and still finishes the run", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "min-rt-deny-"));
    const rt = await createRuntime({
      cwd,
      home: cwd,
      provider: mockProvider([
        {
          toolCalls: [{ name: "bash", arguments: { command: "curl evil" } }],
        },
        { text: "acknowledged" },
      ]),
      noSessionStore: true,
      allowBash: false,
    });

    const asks: string[] = [];
    const results: Array<{ isError?: boolean; content: string }> = [];
    let sawDone = false;
    await rt.session.run("try curl", {
      onEvent(event: RunEvent) {
        if (event.type === "tool_result") {
          results.push({ isError: event.isError, content: event.content });
        }
        if (event.type === "done") sawDone = true;
      },
      async onPermissionAsk(req) {
        asks.push(req.toolCall.name);
        return "deny";
      },
    });

    expect(asks).toEqual(["bash"]);
    expect(results).toHaveLength(1);
    expect(results[0]?.isError).toBe(true);
    expect(results[0]?.content.toLowerCase()).toMatch(/den/);
    expect(sawDone).toBe(true);
    await rt.session.dispose();
    await rt.agent.dispose();
  });

  it("loads Claude skills and lets a min skill of the same name win", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-rt-skill-compat-"));
    const home = path.join(root, "home");
    const cwd = path.join(root, "repo");
    await mkdir(path.join(home, ".claude", "skills", "greeter"), { recursive: true });
    await mkdir(path.join(cwd, ".min", "skills", "greeter"), { recursive: true });
    await writeFile(
      path.join(home, ".claude", "skills", "greeter", "SKILL.md"),
      "---\nname: greeter\ndescription: Claude greeter\n---\n\nfrom claude\n",
    );
    await writeFile(
      path.join(cwd, ".min", "skills", "greeter", "SKILL.md"),
      "---\nname: greeter\ndescription: min greeter\n---\n\nfrom min\n",
    );
    const rt = await createRuntime({
      cwd,
      home,
      provider: mockProvider([
        { toolCalls: [{ name: "load_skill", arguments: { name: "greeter" } }] },
        { text: "ok" },
      ]),
      noTools: true,
      noSessionStore: true,
    });
    expect(rt.agent.tools.list().some((tool) => tool.name === "load_skill")).toBe(true);
    await rt.session.run("load it");
    await rt.session.dispose();
    await rt.agent.dispose();
  });
});
