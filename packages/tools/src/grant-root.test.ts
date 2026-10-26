import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspacePermissionPolicy } from "./permissions.js";
import { createSandbox, SandboxError } from "./sandbox.js";

async function realTemp(prefix: string): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), prefix)));
}

describe("grantRoot tightness contract", () => {
  it("suggests the escaped directory itself, not an ancestor of cwd", async () => {
    const primary = await realTemp("min-grant-p-");
    const outside = await realTemp("min-grant-o-");
    await writeFile(path.join(outside, "secret.txt"), "sec", "utf8");

    const sandbox = createSandbox(primary);
    const escapePath = path.relative(primary, path.join(outside, "secret.txt"));
    const probed = sandbox.probe(escapePath);
    expect(probed.ok).toBe(false);
    if (probed.ok) throw new Error("expected escape");
    expect(probed.suggestedRoot).toBe(outside);
    expect(probed.suggestedRoot).not.toBe(path.dirname(outside));
    expect(probed.suggestedRoot.startsWith(primary)).toBe(false);

    const policy = createWorkspacePermissionPolicy(sandbox);
    const decision = policy.handler({
      toolCall: {
        type: "tool_call",
        id: "1",
        name: "read_file",
        arguments: { path: escapePath },
      },
      messages: [],
      turn: 1,
    });
    expect(decision).toMatchObject({
      action: "ask",
      grantRoot: outside,
    });

    expect(() => sandbox.resolve(escapePath)).toThrow(SandboxError);
    policy.grantRoot(outside);
    expect(sandbox.resolve(escapePath)).toBe(path.join(outside, "secret.txt"));
    expect(sandbox.sessionRoots).toEqual([outside]);
  });
});
