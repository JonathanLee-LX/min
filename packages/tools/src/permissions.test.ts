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

  it("treats edit_file as a write and shows a short diff when asking", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-pol-"));
    const allowed = createWorkspacePermissionPolicy(createSandbox(root));
    expect(
      allowed.handler(
        ctx("edit_file", { path: "a.ts", old_string: "alpha", new_string: "beta" }),
      ),
    ).toEqual({ action: "allow" });

    const asking = createWorkspacePermissionPolicy(createSandbox(root), {
      write: "ask",
    });
    const decision = await asking.handler(
      ctx("edit_file", { path: "a.ts", old_string: "alpha", new_string: "beta" }),
    );
    expect(decision).toMatchObject({ action: "ask" });
    if (decision.action !== "ask") throw new Error("expected ask");
    expect(decision.reason).toContain('edit_file path="a.ts"');
    expect(decision.reason).toContain("- alpha");
    expect(decision.reason).toContain("+ beta");
    expect(decision.reason.length).toBeLessThan(500);

    const multi = await asking.handler(
      ctx("edit_file", {
        path: "a.ts",
        edits: [
          { old_string: "alpha", new_string: "beta" },
          { old_string: "one", new_string: "two", replace_all: true },
        ],
      }),
    );
    expect(multi).toMatchObject({ action: "ask" });
    if (multi.action !== "ask") throw new Error("expected ask");
    expect(multi.reason).toContain("1. replace");
    expect(multi.reason).toContain("- alpha");
    expect(multi.reason).toContain("+ beta");
    expect(multi.reason).toContain("2. replace all");
    expect(multi.reason).toContain("- one");
    expect(multi.reason).toContain("+ two");

    const denied = createWorkspacePermissionPolicy(createSandbox(root), {
      write: "deny",
    });
    expect(
      denied.handler(
        ctx("edit_file", { path: "a.ts", old_string: "alpha", new_string: "beta" }),
      ),
    ).toMatchObject({
      action: "deny",
      reason: expect.stringContaining("- alpha"),
    });
  });

  it("remembers one edit_file path and does not reuse a write_file grant", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-pol-"));
    const policy = createWorkspacePermissionPolicy(createSandbox(root), {
      write: "ask",
    });
    policy.grantSession(
      ctx("write_file", { path: "note.txt", content: "x" }).toolCall,
    );
    expect(
      (
        await policy.handler(
          ctx("edit_file", { path: "note.txt", old_string: "a", new_string: "b" }),
        )
      ).action,
    ).toBe("ask");

    policy.grantSession(
      ctx("edit_file", { path: "note.txt", old_string: "a", new_string: "b" }).toolCall,
    );
    expect(
      policy.handler(
        ctx("edit_file", { path: "note.txt", old_string: "other", new_string: "z" }),
      ),
    ).toEqual({ action: "allow" });
    expect(
      (
        await policy.handler(
          ctx("edit_file", { path: "other.txt", old_string: "a", new_string: "b" }),
        )
      ).action,
    ).toBe("ask");
  });

  it("keeps an escaping edit_file on the root-grant prompt and still shows the diff", async () => {
    const primary = await realTemp("min-pol-p-");
    const outside = await realTemp("min-pol-o-");
    const policy = createWorkspacePermissionPolicy(createSandbox(primary));
    const escapePath = path.relative(primary, path.join(outside, "x.txt"));
    const decision = await policy.handler(
      ctx("edit_file", { path: escapePath, old_string: "secret", new_string: "nope" }),
    );
    expect(decision).toMatchObject({ action: "ask", grantRoot: outside });
    if (decision.action !== "ask") throw new Error("expected ask");
    expect(decision.reason).toContain("- secret");
    expect(decision.reason).toContain("+ nope");
    expect(decision.reason).not.toContain("ENTIRE");
  });

  it("truncates a huge edit diff in the prompt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-pol-"));
    const policy = createWorkspacePermissionPolicy(createSandbox(root), {
      write: "ask",
    });
    const oldString = "Z".repeat(5_000);
    const decision = await policy.handler(
      ctx("edit_file", { path: "a.ts", old_string: oldString, new_string: "short" }),
    );
    expect(decision.action).toBe("ask");
    if (decision.action !== "ask") throw new Error("expected ask");
    expect(decision.reason).not.toContain(oldString);
    expect(decision.reason.length).toBeLessThan(900);
    expect(decision.reason).toContain("…");
  });
});
