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
    expect(parseArgs(["-i"]).contextStrategy).toBe("trim");
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
        "hmt",
        "--list-sessions",
      ]),
    ).toMatchObject({
      yes: true,
      sessionId: "ses_1",
      maxContextTokens: 8000,
      maxUserTurns: 6,
      contextStrategy: "hmt",
      listSessions: true,
    });
  });
});
