import { mockProvider } from "@min-agent/core";
import {
  loadPermissionRules,
  permissionRulesPath,
} from "@min-agent/tools";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createClient } from "./client.js";

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

describe("persistPermissionGrants contract", () => {
  it("does not write permissions.json when persistPermissionGrants is false", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "min-persist-off-"));
    const file = permissionRulesPath(cwd);
    const client = await createClient({
      cwd,
      provider: mockProvider([
        {
          toolCalls: [{ name: "bash", arguments: { command: "curl evil" } }],
        },
        { text: "done" },
      ]),
      noSessionStore: true,
      allowBash: false,
      persistPermissionGrants: false,
      autoApprovePermission: async () => "allow_session" as const,
    });

    await client.send("run curl");
    expect(await exists(file)).toBe(false);
    await client.dispose();
  });

  it("writes a grant when persistPermissionGrants is true", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "min-persist-on-"));
    const file = permissionRulesPath(cwd);
    const client = await createClient({
      cwd,
      provider: mockProvider([
        {
          toolCalls: [{ name: "bash", arguments: { command: "curl evil" } }],
        },
        { text: "done" },
      ]),
      noSessionStore: true,
      allowBash: false,
      persistPermissionGrants: true,
      autoApprovePermission: async () => "allow_session" as const,
    });

    await client.send("run curl");
    expect(await exists(file)).toBe(true);
    const rules = loadPermissionRules(file);
    expect(rules.grants.some((grant) => grant.kind === "bash-prefix")).toBe(true);
    await client.dispose();
  });
});
