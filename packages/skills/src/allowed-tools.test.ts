import type { PermissionContext } from "@min/core";
import { describe, expect, it } from "vitest";
import { createAllowedToolsGate } from "./allowed-tools.js";

const ctx = (name: string): PermissionContext => ({
  toolCall: { type: "tool_call", id: "1", name, arguments: {} },
  messages: [],
  turn: 1,
});

describe("createAllowedToolsGate", () => {
  it("does not restrict tools that are not pre-approved", async () => {
    const gate = createAllowedToolsGate();
    gate.activate({ name: "docs", allowedTools: ["read_file", "glob"] });
    expect([...gate.preapproved()].sort()).toEqual(["glob", "read_file"]);
    expect(await gate.handler(ctx("bash"))).toEqual({ action: "allow" });
  });

  it("unions allowed-tools across loaded skills", async () => {
    const gate = createAllowedToolsGate();
    gate.activate({
      name: "a",
      allowedTools: ["read_file", "write_file"],
    });
    gate.activate({ name: "b", allowedTools: ["bash"] });
    gate.activate({ name: "open", allowedTools: undefined });
    expect([...gate.preapproved()].sort()).toEqual([
      "bash",
      "read_file",
      "write_file",
    ]);
  });

  it("skips ordinary prompts for pre-approved tools and keeps sandbox asks", async () => {
    const gate = createAllowedToolsGate();
    gate.activate({ name: "docs", allowedTools: ["bash", "write_file"] });
    const inner = async (ctx: PermissionContext) => {
      if (ctx.toolCall.name === "write_file") {
        return {
          action: "ask" as const,
          reason: "path outside sandbox",
          grantRoot: "/tmp/other",
        };
      }
      return { action: "ask" as const, reason: "confirm bash" };
    };
    const composed = gate.wrap(inner);
    expect(await composed(ctx("bash"))).toEqual({ action: "allow" });
    expect(await composed(ctx("write_file"))).toEqual({
      action: "ask",
      reason: "path outside sandbox",
      grantRoot: "/tmp/other",
    });
    expect(await composed(ctx("glob"))).toEqual({
      action: "ask",
      reason: "confirm bash",
    });
  });

  it("preserves an explicit deny", async () => {
    const gate = createAllowedToolsGate();
    gate.activate({ name: "docs", allowedTools: ["bash"] });
    const composed = gate.wrap(async () => ({
      action: "deny" as const,
      reason: "blocked",
    }));
    expect(await composed(ctx("bash"))).toEqual({
      action: "deny",
      reason: "blocked",
    });
  });
});
