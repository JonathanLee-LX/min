import { mockProvider } from "@min-agent/core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as runtimeApi from "./index.js";
import { createRuntime } from "./runtime.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("runtime architecture contracts", () => {
  it("composes host packages and does not depend on client or mcp", () => {
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
  });

  it("exports createRuntime as the composition entry", () => {
    expect(typeof runtimeApi.createRuntime).toBe("function");
    expect(runtimeApi.DEFAULT_MAX_TURNS).toBe(40);
  });

  it("does not connect MCP by default; ships workspace tools plus recall", async () => {
    const rt = await createRuntime({
      cwd: process.cwd(),
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
    const rt = await createRuntime({
      cwd: process.cwd(),
      provider: mockProvider([{ text: "ok" }]),
      noSessionStore: true,
    });
    expect(rt.permissions).toBeDefined();
    expect(rt.allowedToolsGate).toBeDefined();
    expect("permissions" in rt.agent).toBe(false);
    await rt.session.dispose();
    await rt.agent.dispose();
  });
});
