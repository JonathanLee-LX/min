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

  it("parses session and context budget flags", () => {
    expect(parseArgs(["-i"]).repl).toBe(true);
    // Default left unset so Runtime picks hybrid (tools) / trim (no-tools).
    expect(parseArgs(["-i"]).contextStrategy).toBeUndefined();
    expect(
      parseArgs([
        "-y",
        "--session",
        "ses_1",
        "--max-context-tokens",
        "8000",
        "--max-user-turns",
        "6",
        "--context-strategy",
        "tool-offload",
        "--list-sessions",
      ]),
    ).toMatchObject({
      yes: true,
      sessionId: "ses_1",
      maxContextTokens: 8000,
      maxUserTurns: 6,
      contextStrategy: "tool-offload",
      listSessions: true,
    });
  });

  it("rejects compact as a continuous strategy", () => {
    expect(() => parseArgs(["--context-strategy", "compact"])).toThrow(
      /trim \| hmt/,
    );
  });

  it("parses --auto and implies yes + bash + root-grant", () => {
    expect(parseArgs(["--auto", "go"])).toMatchObject({
      auto: true,
      yes: true,
      allowBash: true,
      allowRootGrant: true,
      prompt: "go",
    });
  });
});
