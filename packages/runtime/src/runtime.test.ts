import { mockProvider } from "@min/core";
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
});
