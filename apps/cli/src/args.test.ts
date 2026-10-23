import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";

describe("parseArgs", () => {
  it("parses one-shot prompt and flags", () => {
    const args = parseArgs([
      "--provider",
      "deepseek",
      "--cwd",
      "/tmp/ws",
      "list",
      "files",
    ]);
    expect(args.provider).toBe("deepseek");
    expect(args.cwd).toBe("/tmp/ws");
    expect(args.prompt).toBe("list files");
    expect(args.repl).toBe(false);
  });

  it("enables repl and permission flags", () => {
    expect(parseArgs(["-i"]).repl).toBe(true);
    expect(
      parseArgs([
        "-y",
        "--allow-bash",
        "--ask-write",
        "--allow-root-grant",
        "--add-root",
        "/tmp/extra",
      ]),
    ).toMatchObject({
      yes: true,
      allowBash: true,
      askWrite: true,
      allowRootGrant: true,
      addRoots: ["/tmp/extra"],
    });
  });
});
