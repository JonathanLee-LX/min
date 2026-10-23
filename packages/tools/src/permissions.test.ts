import { describe, expect, it } from "vitest";
import { createWorkspacePermissionPolicy } from "./permissions.js";

function ctx(name: string, args: Record<string, unknown> = {}) {
  return {
    toolCall: { type: "tool_call" as const, id: "1", name, arguments: args },
    messages: [],
    turn: 1,
  };
}

describe("createWorkspacePermissionPolicy", () => {
  it("allows read/write by default and asks for bash", async () => {
    const policy = createWorkspacePermissionPolicy();
    expect(await policy.handler(ctx("read_file", { path: "a" }))).toEqual({
      action: "allow",
    });
    expect(await policy.handler(ctx("write_file", { path: "a" }))).toEqual({
      action: "allow",
    });
    expect(policy.handler(ctx("bash", { command: "rm -rf /" }))).toMatchObject({
      action: "ask",
      reason: expect.stringContaining("bash:"),
    });
  });

  it("auto-allows bash allowlist prefixes", async () => {
    const policy = createWorkspacePermissionPolicy();
    expect(await policy.handler(ctx("bash", { command: "ls -la" }))).toEqual({
      action: "allow",
    });
    expect(await policy.handler(ctx("bash", { command: "pwd" }))).toEqual({
      action: "allow",
    });
    expect(await policy.handler(ctx("bash", { command: "git status" }))).toEqual(
      { action: "allow" },
    );
  });

  it("honors session grants after allow_session", async () => {
    const policy = createWorkspacePermissionPolicy({ bash: "ask" });
    const call = ctx("bash", { command: "curl evil" }).toolCall;
    expect((await policy.handler(ctx("bash", { command: "curl evil" }))).action).toBe(
      "ask",
    );
    policy.grantSession(call);
    expect(await policy.handler(ctx("bash", { command: "curl evil" }))).toEqual({
      action: "allow",
    });
  });

  it("can deny write", async () => {
    const policy = createWorkspacePermissionPolicy({ write: "deny" });
    expect(policy.handler(ctx("write_file", { path: "x" }))).toMatchObject({
      action: "deny",
      reason: expect.stringContaining("write_file"),
    });
  });
});
