import type { PermissionContext } from "@min/core";
import { describe, expect, it } from "vitest";
import { createAllowedToolsGate } from "./allowed-tools.js";

const ctx = (name: string): PermissionContext => ({
  toolCall: { type: "tool_call", id: "1", name, arguments: {} },
  messages: [],
  turn: 1,
});

describe("createAllowedToolsGate", () => {
  it("allows all tools until a restricted skill is activated", async () => {
    const gate = createAllowedToolsGate();
    expect(await gate.handler(ctx("bash"))).toEqual({ action: "allow" });
    gate.activate({ name: "docs", allowedTools: ["read_file", "glob"] });
    expect(await gate.handler(ctx("read_file"))).toEqual({ action: "allow" });
    expect(await gate.handler(ctx("bash"))).toMatchObject({ action: "deny" });
    expect(await gate.handler(ctx("load_skill"))).toEqual({ action: "allow" });
  });

  it("intersects when a second restricted skill loads", async () => {
    const gate = createAllowedToolsGate();
    gate.activate({
      name: "a",
      allowedTools: ["read_file", "write_file", "glob"],
    });
    gate.activate({ name: "b", allowedTools: ["read_file", "bash"] });
    expect([...gate.activeAllowlist()!].sort()).toEqual(["read_file"]);
    expect(await gate.handler(ctx("write_file"))).toMatchObject({
      action: "deny",
    });
  });

  it("skills without allowed-tools do not widen a restriction", async () => {
    const gate = createAllowedToolsGate();
    gate.activate({ name: "a", allowedTools: ["read_file"] });
    gate.activate({ name: "open", allowedTools: undefined });
    expect([...gate.activeAllowlist()!]).toEqual(["read_file"]);
  });

  it("wrap runs gate before inner policy", async () => {
    const gate = createAllowedToolsGate();
    gate.activate({ name: "a", allowedTools: ["read_file"] });
    const inner = async () =>
      ({ action: "ask" as const, reason: "sandbox" });
    const composed = gate.wrap(inner);
    expect(await composed(ctx("bash"))).toMatchObject({ action: "deny" });
    expect(await composed(ctx("read_file"))).toEqual({
      action: "ask",
      reason: "sandbox",
    });
  });
});
