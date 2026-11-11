import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceTools } from "./tools.js";

const renameState = vi.hoisted(() => ({ tempExisted: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const nodePath = await import("node:path");
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0]) => {
      const names = await actual.readdir(nodePath.dirname(String(from)));
      renameState.tempExisted = names.some((name) => name.endsWith(".tmp"));
      throw new Error("rename failed");
    },
  };
});

describe("edit_file rename failure", () => {
  beforeEach(() => {
    renameState.tempExisted = false;
  });

  it("removes the temp file when rename fails and leaves the original", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-edit-rename-"));
    const file = path.join(root, "a.txt");
    await writeFile(file, "alpha\n", "utf8");
    const { tools } = createWorkspaceTools({ root });
    const edit = tools.find((tool) => tool.name === "edit_file");
    const read = tools.find((tool) => tool.name === "read_file");
    expect(edit).toBeDefined();
    expect(read).toBeDefined();
    await read!.execute({ path: "a.txt" }, {});

    const result = await edit!.execute(
      { path: "a.txt", old_string: "alpha", new_string: "beta" },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/rename failed/);
    expect(renameState.tempExisted).toBe(true);
    expect(await readFile(file, "utf8")).toBe("alpha\n");
    const left = await readdir(root);
    expect(left.filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
