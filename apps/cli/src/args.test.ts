import { describe, expect, it } from "vitest";
import { helpText, parseArgs } from "./args.js";

describe("parseArgs", () => {
  it("parses one-shot -p prompt and flags", () => {
    const args = parseArgs([
      "--provider",
      "deepseek",
      "--cwd",
      "/tmp/ws",
      "-p",
      "list files",
    ]);
    expect(args.provider).toBe("deepseek");
    expect(args.cwd).toBe("/tmp/ws");
    expect(args.prompt).toBe("list files");
    expect(args.repl).toBe(false);
  });

  it("accepts --prompt= and appends leftover positionals", () => {
    expect(parseArgs(["--prompt=hi", "there"])).toMatchObject({
      prompt: "hi there",
    });
  });

  it("parses session and context budget flags", () => {
    expect(parseArgs(["-i"]).repl).toBe(true);
    // Default left unset so Runtime picks hybrid (tools) / trim (no-tools).
    expect(parseArgs(["-i"]).contextStrategy).toBeUndefined();
    expect(parseArgs(["-i"]).maxContextTokens).toBe(256_000);
    expect(
      parseArgs([
        "-y",
        "--session",
        "ses_1",
        "--max-context-tokens",
        "8000",
        "--max-user-turns",
        "6",
        "--max-turns",
        "80",
        "--context-strategy",
        "tool-offload",
        "--list-sessions",
      ]),
    ).toMatchObject({
      yes: true,
      sessionId: "ses_1",
      maxContextTokens: 8000,
      maxUserTurns: 6,
      maxTurns: 80,
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
    expect(parseArgs(["--auto", "-p", "go"])).toMatchObject({
      auto: true,
      yes: true,
      allowBash: true,
      allowRootGrant: true,
      prompt: "go",
    });
  });

  it("documents -p one-shot in help", () => {
    expect(helpText()).toContain('-p, --prompt');
    expect(helpText()).toContain('min -p "your prompt"');
  });
});
