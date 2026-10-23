import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSandbox, SandboxError } from "./sandbox.js";
import { createWorkspaceTools } from "./tools.js";

describe("sandbox", () => {
  it("resolves inside root and rejects escapes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-sb-"));
    const sb = createSandbox(root);
    expect(sb.resolve("a/b")).toBe(path.join(root, "a/b"));
    expect(() => sb.resolve("../outside")).toThrow(SandboxError);
  });

  it("probe suggests a tight root and grantRoot enables resolve", async () => {
    const primary = await mkdtemp(path.join(tmpdir(), "min-primary-"));
    const outside = await mkdtemp(path.join(tmpdir(), "min-outside-"));
    await writeFile(path.join(outside, "secret.txt"), "sec", "utf8");

    const sb = createSandbox(primary);
    const relEscape = path.relative(primary, path.join(outside, "secret.txt"));
    const probed = sb.probe(relEscape);
    expect(probed.ok).toBe(false);
    if (probed.ok) throw new Error("expected escape");
    expect(probed.suggestedRoot).toBe(outside);

    expect(() => sb.resolve(relEscape)).toThrow(SandboxError);
    sb.grantRoot(probed.suggestedRoot);
    expect(sb.sessionRoots).toContain(outside);
    expect(sb.resolve(relEscape)).toBe(path.join(outside, "secret.txt"));
  });
});

describe("workspace tools", () => {
  it("reads, writes, globs, and runs bash inside the sandbox", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "min-tools-"));
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "hi.txt"), "hello", "utf8");

    const { tools } = createWorkspaceTools({ root });
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    const read = await byName.read_file!.execute({ path: "src/hi.txt" }, {});
    expect(read.content).toBe("hello");

    const written = await byName.write_file!.execute(
      { path: "src/out.txt", content: "out" },
      {},
    );
    expect(written.isError).toBeFalsy();

    const listed = await byName.glob!.execute(
      { dir: "src", filter: ".txt", recursive: false, limit: 50 },
      {},
    );
    expect(listed.content).toContain("src/hi.txt");
    expect(listed.content).toContain("src/out.txt");

    const bash = await byName.bash!.execute({ command: "pwd" }, {});
    expect(bash.content).toContain(root);
    expect(bash.isError).toBeFalsy();

    const escape = await byName.read_file!.execute(
      { path: "../secret" },
      {},
    );
    expect(escape.isError).toBe(true);
  });
});
