import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bashShape,
  emptyPermissionRules,
  loadPermissionRules,
  parsePermissionRules,
  permissionRulesPath,
  savePermissionRules,
  type PermissionRules,
} from "./grants.js";
import { createSandbox, SandboxError } from "./sandbox.js";
import { createWorkspaceTools } from "./tools.js";

describe("tools architecture contracts", () => {
  it("freezes permission rules document version 1", () => {
    const rules = emptyPermissionRules();
    expect(rules).toEqual({ version: 1, grants: [], roots: [] });
    const parsed = parsePermissionRules({
      version: 1,
      grants: [{ kind: "tool", name: "bash" }],
      roots: ["/tmp/project"],
      unknownFuture: true,
    });
    expect(parsed.version).toBe(1);
    expect(parsed.grants).toEqual([{ kind: "tool", name: "bash" }]);
    expect(parsed.roots).toEqual(["/tmp/project"]);
  });

  it("round-trips permission rules under .min/permissions.json", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "min-perm-"));
    const file = permissionRulesPath(cwd);
    expect(file.endsWith(path.join(".min", "permissions.json"))).toBe(true);
    const rules: PermissionRules = {
      version: 1,
      grants: [{ kind: "bash-prefix", prefix: "git" }],
      roots: [],
    };
    savePermissionRules(file, rules);
    const raw = await readFile(file, "utf8");
    expect(JSON.parse(raw).version).toBe(1);
    expect(loadPermissionRules(file)).toEqual(rules);
  });

  it("remembers bash by first token unless shell syntax forces exact match", () => {
    expect(bashShape("ls -la")).toEqual({ kind: "prefix", prefix: "ls" });
    expect(bashShape("echo hi | wc")).toEqual({
      kind: "exact",
      command: "echo hi | wc",
    });
  });

  it("never lets workspace tools escape the sandbox root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-ws-"));
    await writeFile(path.join(root, "inside.txt"), "ok", "utf8");
    const { tools, sandbox } = createWorkspaceTools({ root });
    const read = tools.find((tool) => tool.name === "read_file");
    expect(read).toBeDefined();
    const escaped = await read!.execute({ path: "../outside.txt" }, {});
    expect(escaped.isError).toBe(true);
    expect(() => sandbox.resolve("../outside.txt")).toThrow(SandboxError);
  });
});
