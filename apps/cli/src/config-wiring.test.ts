import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";
import { createCliClient } from "./run.js";

describe("parseArgs flags", () => {
  it("records explicit flags without copying env defaults", () => {
    const previous = process.env.MIN_MAX_TURNS;
    process.env.MIN_MAX_TURNS = "9";
    try {
      const args = parseArgs(["-i"]);
      expect(args.maxTurns).toBe(9);
      expect(args.flags.maxTurns).toBeUndefined();
      expect(args.flags).toEqual({});
    } finally {
      if (previous === undefined) delete process.env.MIN_MAX_TURNS;
      else process.env.MIN_MAX_TURNS = previous;
    }
  });

  it("records flag overrides that should beat a config file", () => {
    expect(
      parseArgs([
        "--provider",
        "mock",
        "--model",
        "flag-model",
        "--max-turns",
        "3",
        "--max-context-tokens",
        "4096",
        "--context-strategy",
        "trim",
        "--session-dir",
        "/tmp/sessions",
      ]).flags,
    ).toEqual({
      provider: "mock",
      model: "flag-model",
      maxTurns: 3,
      maxContextTokens: 4096,
      contextStrategy: "trim",
      sessionDir: "/tmp/sessions",
    });
  });
});

describe("createCliClient config", () => {
  it("applies project preferences and lets flags win", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "min-cli-config-"));
    mkdirSync(path.join(cwd, ".min"), { recursive: true });
    writeFileSync(
      path.join(cwd, ".min", "config.json"),
      JSON.stringify({
        version: 1,
        provider: "mock",
        model: "from-file",
        runtime: { maxTurns: 7, maxContextTokens: 8192, contextStrategy: "hybrid" },
      }),
    );
    writeFileSync(
      path.join(cwd, ".min", "settings.json"),
      JSON.stringify({ version: 1, permissions: { bash: "allow", write: "ask" } }),
    );

    const fromFile = await createCliClient(
      parseArgs(["-p", "hi", "--cwd", cwd, "--no-tools", "--no-session-store"]),
    );
    expect(fromFile.args.provider).toBe("mock");
    expect(fromFile.args.model).toBe("from-file");
    expect(fromFile.args.maxTurns).toBe(7);
    expect(fromFile.args.maxContextTokens).toBe(8192);
    expect(fromFile.args.contextStrategy).toBe("hybrid");
    expect(fromFile.args.allowBash).toBe(true);
    expect(fromFile.args.askWrite).toBe(true);
    await fromFile.client.dispose();

    const flagged = await createCliClient(
      parseArgs([
        "-p",
        "hi",
        "--cwd",
        cwd,
        "--no-tools",
        "--no-session-store",
        "--provider",
        "mock",
        "--model",
        "flag-model",
        "--max-turns",
        "3",
      ]),
    );
    expect(flagged.args.provider).toBe("mock");
    expect(flagged.args.model).toBe("flag-model");
    expect(flagged.args.maxTurns).toBe(3);
    expect(flagged.args.allowBash).toBe(true);
    await flagged.client.dispose();
  });
});
