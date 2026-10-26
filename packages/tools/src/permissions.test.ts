import { realpathSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadPermissionRules,
  permissionRulesPath,
  savePermissionRules,
} from "./grants.js";
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

  it("remembers a bash prefix, not the whole tool", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-pol-"));
    const policy = createWorkspacePermissionPolicy(createSandbox(root), {
      bash: "ask",
    });
    const call = ctx("bash", { command: "curl evil" }).toolCall;
    expect(policy.handler(ctx("bash", { command: "curl evil" }))).toMatchObject({
      action: "ask",
      reason: expect.stringContaining('commands starting with "curl"'),
    });
    expect(policy.grantSession(call)).toEqual({
      kind: "bash-prefix",
      prefix: "curl",
    });
    expect(policy.handler(ctx("bash", { command: "curl other" }))).toEqual({
      action: "allow",
    });
    expect((await policy.handler(ctx("bash", { command: "wget x" }))).action).toBe(
      "ask",
    );
    expect(
      (await policy.handler(ctx("bash", { command: "curl x && rm -rf /" }))).action,
    ).toBe("ask");
  });

  it("remembers a compound bash command exactly", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-pol-"));
    const policy = createWorkspacePermissionPolicy(createSandbox(root));
    const call = ctx("bash", { command: "curl x && rm -rf /" }).toolCall;
    policy.grantSession(call);
    expect(
      policy.handler(ctx("bash", { command: "curl x && rm -rf /" })),
    ).toEqual({ action: "allow" });
    expect((await policy.handler(ctx("bash", { command: "curl y" }))).action).toBe(
      "ask",
    );
  });

  it("remembers one write path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-pol-"));
    const policy = createWorkspacePermissionPolicy(createSandbox(root), {
      write: "ask",
    });
    policy.grantSession(ctx("write_file", { path: "./note.txt" }).toolCall);
    expect(policy.handler(ctx("write_file", { path: "note.txt" }))).toEqual({
      action: "allow",
    });
    expect(
      (await policy.handler(ctx("write_file", { path: "other.txt" }))).action,
    ).toBe("ask");
  });

  it("does not let a remembered path override an explicit deny", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-pol-"));
    const policy = createWorkspacePermissionPolicy(createSandbox(root), {
      write: "deny",
    });
    policy.grantSession(ctx("write_file", { path: "x" }).toolCall);
    expect(policy.handler(ctx("write_file", { path: "x" }))).toMatchObject({
      action: "deny",
    });
  });

  it("asks for unknown tools and can trust or remember them", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-pol-"));
    const policy = createWorkspacePermissionPolicy(createSandbox(root), {
      trustedTools: ["load_skill"],
    });
    expect(policy.handler(ctx("load_skill", { name: "writer" }))).toEqual({
      action: "allow",
    });
    expect(policy.handler(ctx("mcp_fs", { path: "." }))).toMatchObject({
      action: "ask",
      reason: expect.stringContaining('tool "mcp_fs"'),
    });
    policy.grantSession(ctx("mcp_fs", { path: "." }).toolCall);
    expect(policy.handler(ctx("mcp_fs", { path: "other" }))).toEqual({
      action: "allow",
    });
    expect((await policy.handler(ctx("mcp_other"))).action).toBe("ask");
  });

  it("reloads persisted grants and roots", async () => {
    const primary = await realTemp("min-pol-p-");
    const outside = await realTemp("min-pol-o-");
    const file = permissionRulesPath(primary);
    const first = createWorkspacePermissionPolicy(createSandbox(primary), {
      onRulesChange(rules) {
        savePermissionRules(file, rules);
      },
    });
    first.grantSession(ctx("bash", { command: "curl evil" }).toolCall, {
      persist: true,
    });
    first.grantRoot(outside, { persist: true });

    const saved = loadPermissionRules(file);
    expect(saved.grants).toEqual([{ kind: "bash-prefix", prefix: "curl" }]);
    expect(saved.roots.length).toBe(1);

    const second = createWorkspacePermissionPolicy(createSandbox(primary), {
      rules: loadPermissionRules(file),
    });
    expect(second.handler(ctx("bash", { command: "curl again" }))).toEqual({
      action: "allow",
    });
    const escapePath = path.relative(primary, path.join(outside, "x.txt"));
    expect(second.handler(ctx("read_file", { path: escapePath }))).toEqual({
      action: "allow",
    });
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);
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
