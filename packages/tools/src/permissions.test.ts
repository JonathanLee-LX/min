import { realpathSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspacePermissionPolicy } from "./permissions.js";
import { createSandbox } from "./sandbox.js";

/** macOS tmpdir may be /var/... while realpath is /private/var/... */
async function realTemp(prefix: string): Promise<string> {
  return realpathSync(await mkdtemp(path.join(tmpdir(), prefix)));
}

function ctx(name: string, args: Record<string, unknown> = {}) {
  return {
    toolCall: { type: "tool_call" as const, id: "1", name, arguments: args },
    messages: [],
    turn: 1,
  };
}

describe("createWorkspacePermissionPolicy", () => {
  it("allows read/write by default and asks for bash", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-pol-"));
    const policy = createWorkspacePermissionPolicy(createSandbox(root));
    expect(policy.handler(ctx("read_file", { path: "a" }))).toEqual({
      action: "allow",
    });
    expect(policy.handler(ctx("write_file", { path: "a" }))).toEqual({
      action: "allow",
    });
    expect(policy.handler(ctx("bash", { command: "rm -rf /" }))).toMatchObject({
      action: "ask",
      reason: expect.stringContaining("bash:"),
    });
  });

  it("asks to grantRoot when path escapes sandbox", async () => {
    const primary = await realTemp("min-pol-p-");
    const outside = await realTemp("min-pol-o-");
    await writeFile(path.join(outside, "x.txt"), "x", "utf8");
    const sandbox = createSandbox(primary);
    const policy = createWorkspacePermissionPolicy(sandbox);
    const escapePath = path.relative(primary, path.join(outside, "x.txt"));

    const decision = policy.handler(ctx("read_file", { path: escapePath }));
    expect(decision).toMatchObject({
      action: "ask",
      grantRoot: outside,
    });

    policy.grantRoot(outside);
    expect(policy.handler(ctx("read_file", { path: escapePath }))).toEqual({
      action: "allow",
    });
  });

  it("auto-allows bash allowlist prefixes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-pol-"));
    const policy = createWorkspacePermissionPolicy(createSandbox(root));
    expect(policy.handler(ctx("bash", { command: "ls -la" }))).toEqual({
      action: "allow",
    });
    expect(policy.handler(ctx("bash", { command: "pwd" }))).toEqual({
      action: "allow",
    });
    expect(policy.handler(ctx("bash", { command: "git status" }))).toEqual({
      action: "allow",
    });
  });

  it("honors session grants after allow_session", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-pol-"));
    const policy = createWorkspacePermissionPolicy(createSandbox(root), {
      bash: "ask",
    });
    const call = ctx("bash", { command: "curl evil" }).toolCall;
    expect(
      (await Promise.resolve(policy.handler(ctx("bash", { command: "curl evil" }))))
        .action,
    ).toBe("ask");
    policy.grantSession(call);
    expect(policy.handler(ctx("bash", { command: "curl evil" }))).toEqual({
      action: "allow",
    });
  });

  it("can deny write", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-pol-"));
    const policy = createWorkspacePermissionPolicy(createSandbox(root), {
      write: "deny",
    });
    expect(policy.handler(ctx("write_file", { path: "x" }))).toMatchObject({
      action: "deny",
      reason: expect.stringContaining("write_file"),
    });
  });
});
