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
    const result = await rt.session.run("hi");
    expect(result.text).toBe("ok");
    await rt.session.dispose();
    await rt.agent.dispose();
  });
});
