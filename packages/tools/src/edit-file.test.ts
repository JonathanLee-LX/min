import { readFileSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "@min-agent/core";
import { describe, expect, it } from "vitest";
import { workspaceTools } from "./index.js";
import { createPermissionGate } from "./permission-protocol.js";
import { createWorkspacePermissionPolicy } from "./permissions.js";
import { createWorkspaceTools } from "./tools.js";

async function realTemp(prefix: string): Promise<string> {
  return realpathSync(await mkdtemp(path.join(tmpdir(), prefix)));
}

function byName(tools: readonly Tool[]): Record<string, Tool> {
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

/** Same heuristic as estimateTextTokens in packages/session/src/tokens.ts. */
function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

describe("edit_file", () => {
  it("replaces one exact match and keeps a later edit fresh", async () => {
    const root = await realTemp("min-edit-");
    const file = path.join(root, "a.txt");
    await writeFile(file, "hello world\n", "utf8");
    const { tools } = createWorkspaceTools({ root });
    const toolsByName = byName(tools);

    const unread = await toolsByName.edit_file!.execute(
      { path: "a.txt", old_string: "world", new_string: "there" },
      {},
    );
    expect(unread.isError).toBe(true);
    expect(unread.content).toMatch(/read_file/);
    expect(await readFile(file, "utf8")).toBe("hello world\n");

    expect((await toolsByName.read_file!.execute({ path: "a.txt" }, {})).content).toBe(
      "hello world\n",
    );
    const edited = await toolsByName.edit_file!.execute(
      { path: "a.txt", old_string: "world", new_string: "there" },
      {},
    );
    expect(edited.isError).toBeFalsy();
    expect(edited.content).toBe("Edited a.txt (1 replacement).");
    expect(await readFile(file, "utf8")).toBe("hello there\n");

    const again = await toolsByName.edit_file!.execute(
      { path: "a.txt", old_string: "there", new_string: "friend" },
      {},
    );
    expect(again.isError).toBeFalsy();
    expect(await readFile(file, "utf8")).toBe("hello friend\n");
  });

  it("reports not found and several matches without returning the file", async () => {
    const root = await realTemp("min-edit-");
    const sentinel = `SENTINEL_${"q".repeat(80)}`;
    const file = path.join(root, "a.txt");
    await writeFile(file, `foo foo\n${sentinel}\n`, "utf8");
    const { tools } = createWorkspaceTools({ root });
    const toolsByName = byName(tools);
    await toolsByName.read_file!.execute({ path: "a.txt" }, {});

    const missing = await toolsByName.edit_file!.execute(
      { path: "a.txt", old_string: "missing", new_string: "x" },
      {},
    );
    expect(missing.isError).toBe(true);
    expect(missing.content).toMatch(/not found/);
    expect(missing.content).toMatch(/surrounding context/);
    expect(missing.content).not.toContain(sentinel);
    expect(missing.content!.length).toBeLessThan(300);

    const many = await toolsByName.edit_file!.execute(
      { path: "a.txt", old_string: "foo", new_string: "bar" },
      {},
    );
    expect(many.isError).toBe(true);
    expect(many.content).toMatch(/matched 2 times/);
    expect(many.content).toMatch(/replace_all/);
    expect(many.content).not.toContain(sentinel);
    expect(await readFile(file, "utf8")).toBe(`foo foo\n${sentinel}\n`);
  });

  it("does not write when old_string is empty, replace_all misses, or both forms are set", async () => {
    const root = await realTemp("min-edit-");
    const file = path.join(root, "a.txt");
    await writeFile(file, "alpha\n", "utf8");
    const { tools } = createWorkspaceTools({ root });
    const toolsByName = byName(tools);
    await toolsByName.read_file!.execute({ path: "a.txt" }, {});

    const empty = await toolsByName.edit_file!.execute(
      { path: "a.txt", old_string: "", new_string: "x" },
      {},
    );
    expect(empty.isError).toBe(true);
    expect(empty.content).toMatch(/empty/);

    const missed = await toolsByName.edit_file!.execute(
      { path: "a.txt", old_string: "nope", new_string: "x", replace_all: true },
      {},
    );
    expect(missed.isError).toBe(true);
    expect(missed.content).toMatch(/not found/);

    const both = await toolsByName.edit_file!.execute(
      {
        path: "a.txt",
        old_string: "alpha",
        new_string: "beta",
        edits: [{ old_string: "alpha", new_string: "beta" }],
      },
      {},
    );
    expect(both.isError).toBe(true);
    expect(both.content).toMatch(/not both/);
    expect(await readFile(file, "utf8")).toBe("alpha\n");
  });

  it("replace_all changes every match", async () => {
    const root = await realTemp("min-edit-");
    const file = path.join(root, "a.txt");
    await writeFile(file, "a a a\n", "utf8");
    const { tools } = createWorkspaceTools({ root });
    const toolsByName = byName(tools);
    await toolsByName.read_file!.execute({ path: "a.txt" }, {});
    const edited = await toolsByName.edit_file!.execute(
      { path: "a.txt", old_string: "a", new_string: "b", replace_all: true },
      {},
    );
    expect(edited.isError).toBeFalsy();
    expect(edited.content).toContain("3 replacements");
    expect(await readFile(file, "utf8")).toBe("b b b\n");
  });

  it("rolls back when a later edit fails", async () => {
    const root = await realTemp("min-edit-");
    const file = path.join(root, "a.txt");
    await writeFile(file, "one two two\n", "utf8");
    const { tools } = createWorkspaceTools({ root });
    const toolsByName = byName(tools);
    await toolsByName.read_file!.execute({ path: "a.txt" }, {});
    const failed = await toolsByName.edit_file!.execute(
      {
        path: "a.txt",
        edits: [
          { old_string: "one", new_string: "ONE" },
          { old_string: "two", new_string: "TWO" },
        ],
      },
      {},
    );
    expect(failed.isError).toBe(true);
    expect(failed.content).toMatch(/edit 2/);
    expect(failed.content).toMatch(/matched 2 times/);
    expect(await readFile(file, "utf8")).toBe("one two two\n");

    const edited = await toolsByName.edit_file!.execute(
      {
        path: "a.txt",
        edits: [
          { old_string: "one", new_string: "ONE" },
          { old_string: "two two", new_string: "TWO" },
        ],
      },
      {},
    );
    expect(edited.isError).toBeFalsy();
    expect(await readFile(file, "utf8")).toBe("ONE TWO\n");
  });

  it("preserves CRLF and a trailing newline, and does not add one", async () => {
    const root = await realTemp("min-edit-");
    const crlf = path.join(root, "crlf.txt");
    const bare = path.join(root, "bare.txt");
    await writeFile(crlf, Buffer.from("alpha\r\nbeta\r\n", "utf8"));
    await writeFile(bare, Buffer.from("alpha", "utf8"));
    const { tools } = createWorkspaceTools({ root });
    const toolsByName = byName(tools);
    await toolsByName.read_file!.execute({ path: "crlf.txt" }, {});
    await toolsByName.read_file!.execute({ path: "bare.txt" }, {});

    expect(
      (
        await toolsByName.edit_file!.execute(
          { path: "crlf.txt", old_string: "beta", new_string: "gamma" },
          {},
        )
      ).isError,
    ).toBeFalsy();
    expect(await readFile(crlf)).toEqual(Buffer.from("alpha\r\ngamma\r\n", "utf8"));

    expect(
      (
        await toolsByName.edit_file!.execute(
          { path: "bare.txt", old_string: "alpha", new_string: "ALPHA" },
          {},
        )
      ).isError,
    ).toBeFalsy();
    expect(await readFile(bare)).toEqual(Buffer.from("ALPHA", "utf8"));
  });

  it("rejects a file over the read limit without writing or echoing it", async () => {
    const root = await realTemp("min-edit-");
    const file = path.join(root, "big.txt");
    const body = `HEAD\n${"x".repeat(200_000)}`;
    await writeFile(file, body, "utf8");
    const { tools } = createWorkspaceTools({ root });
    const toolsByName = byName(tools);
    const result = await toolsByName.edit_file!.execute(
      { path: "big.txt", old_string: "HEAD", new_string: "TAIL" },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/too large/);
    expect(result.content!.length).toBeLessThan(120);
    expect(result.content).not.toContain("HEAD");
    expect(await readFile(file, "utf8")).toBe(body);
  });

  it("rejects binary files", async () => {
    const root = await realTemp("min-edit-");
    const file = path.join(root, "b.bin");
    const body = Buffer.from("hello\0world");
    await writeFile(file, body);
    const { tools } = createWorkspaceTools({ root });
    const result = await byName(tools).edit_file!.execute(
      { path: "b.bin", old_string: "hello", new_string: "hi" },
      {},
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/binary|UTF-8/);
    expect(await readFile(file)).toEqual(body);
  });

  it("denies path traversal and a symlink that leaves the root", async () => {
    const root = await realTemp("min-edit-");
    const outside = await realTemp("min-edit-out-");
    const secret = path.join(outside, "secret.txt");
    await writeFile(secret, "secret", "utf8");
    await symlink(secret, path.join(root, "link.txt"));
    await symlink(outside, path.join(root, "out"));
    const { tools } = createWorkspaceTools({ root });
    const edit = byName(tools).edit_file!;

    const traversed = await edit.execute(
      {
        path: path.relative(root, secret),
        old_string: "secret",
        new_string: "nope",
      },
      {},
    );
    expect(traversed.isError).toBe(true);
    expect(traversed.content).toMatch(/sandbox/);

    const linked = await edit.execute(
      { path: "link.txt", old_string: "secret", new_string: "nope" },
      {},
    );
    expect(linked.isError).toBe(true);
    expect(linked.content).toMatch(/sandbox/);

    const viaDir = await edit.execute(
      { path: "out/secret.txt", old_string: "secret", new_string: "nope" },
      {},
    );
    expect(viaDir.isError).toBe(true);
    expect(await readFile(secret, "utf8")).toBe("secret");
  });

  it("follows a symlink whose target stays inside the root", async () => {
    const root = await realTemp("min-edit-");
    await writeFile(path.join(root, "real.txt"), "hello\n", "utf8");
    await symlink(path.join(root, "real.txt"), path.join(root, "alias.txt"));
    const { tools } = createWorkspaceTools({ root });
    const toolsByName = byName(tools);
    await toolsByName.read_file!.execute({ path: "alias.txt" }, {});
    const edited = await toolsByName.edit_file!.execute(
      { path: "alias.txt", old_string: "hello", new_string: "hi" },
      {},
    );
    expect(edited.isError).toBeFalsy();
    expect(await readFile(path.join(root, "real.txt"), "utf8")).toBe("hi\n");
  });

  it("does not write when authorization is denied, and writes when it is allowed", async () => {
    const root = await realTemp("min-edit-");
    const file = path.join(root, "a.txt");
    await writeFile(file, "alpha\n", "utf8");
    const { sandbox, tools } = createWorkspaceTools({ root });
    const policy = createWorkspacePermissionPolicy(sandbox, { write: "ask" });
    const gate = createPermissionGate(policy.handler);
    const wrapped = byName(gate.wrap(tools));
    await wrapped.read_file!.execute({ path: "a.txt" }, {});

    let reason = "";
    gate.setAsk(async (req) => {
      reason = req.reason;
      return "deny";
    });
    const denied = await wrapped.edit_file!.execute(
      { path: "a.txt", old_string: "alpha", new_string: "beta" },
      {},
    );
    expect(denied.isError).toBe(true);
    expect(denied.content).toMatch(/Permission denied/);
    expect(reason).toContain("- alpha");
    expect(reason).toContain("+ beta");
    expect(await readFile(file, "utf8")).toBe("alpha\n");

    gate.setAsk(async () => "allow");
    const allowed = await wrapped.edit_file!.execute(
      { path: "a.txt", old_string: "alpha", new_string: "beta" },
      {},
    );
    expect(allowed.isError).toBeFalsy();
    expect(await readFile(file, "utf8")).toBe("beta\n");
  });

  it("refuses a file that changed since read_file, and accepts a write_file snapshot", async () => {
    const root = await realTemp("min-edit-");
    const file = path.join(root, "a.txt");
    await writeFile(file, "alpha\n", "utf8");
    const { tools } = createWorkspaceTools({ root });
    const toolsByName = byName(tools);
    await toolsByName.read_file!.execute({ path: "a.txt" }, {});
    await writeFile(file, "external\n", "utf8");
    const stale = await toolsByName.edit_file!.execute(
      { path: "a.txt", old_string: "external", new_string: "nope" },
      {},
    );
    expect(stale.isError).toBe(true);
    expect(stale.content).toMatch(/changed/);
    expect(stale.content).not.toContain("external\n");
    expect(await readFile(file, "utf8")).toBe("external\n");

    const written = await toolsByName.write_file!.execute(
      { path: "made.txt", content: "v1\n" },
      {},
    );
    expect(written.isError).toBeFalsy();
    const edited = await toolsByName.edit_file!.execute(
      { path: "made.txt", old_string: "v1", new_string: "v2" },
      {},
    );
    expect(edited.isError).toBeFalsy();
    expect(await readFile(path.join(root, "made.txt"), "utf8")).toBe("v2\n");
  });

  it("prefers edit_file in the workspace system note", async () => {
    const root = await realTemp("min-edit-");
    const bundle = workspaceTools({ root, enforcePermissions: false });
    expect(bundle.system).toContain("Prefer edit_file");
    expect(bundle.system).toContain("write_file");
    expect(bundle.tools.map((tool) => tool.name)).toContain("edit_file");
  });

  it("uses far fewer output tokens than write_file for the same small edit", () => {
    const tokensSource = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../session/src/tokens.ts"),
      "utf8",
    );
    expect(tokensSource).toContain("return Math.max(1, Math.ceil(text.length / 4))");

    const filler = "const line = 1;\n".repeat(4_000);
    const before = `${filler}const NEEDLE = 1;\n${filler}`;
    const after = before.replace("const NEEDLE = 1;", "const NEEDLE = 2;");
    const writeArgs = JSON.stringify({ path: "big.ts", content: after });
    const editArgs = JSON.stringify({
      path: "big.ts",
      old_string: "const NEEDLE = 1;",
      new_string: "const NEEDLE = 2;",
    });
    const writeTokens = estimateTextTokens(writeArgs);
    const editTokens = estimateTextTokens(editArgs);
    expect(editArgs.length).toBeLessThan(writeArgs.length / 20);
    expect(editTokens).toBeLessThan(writeTokens / 20);
    console.log(
      JSON.stringify({
        estimator: "packages/session/src/tokens.ts estimateTextTokens (ceil chars/4)",
        writeChars: writeArgs.length,
        editChars: editArgs.length,
        writeTokens,
        editTokens,
      }),
    );
  });
});
