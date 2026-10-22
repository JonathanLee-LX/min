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

  it("enables repl", () => {
    expect(parseArgs(["-i"]).repl).toBe(true);
  });
});
