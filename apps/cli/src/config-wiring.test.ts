import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { userProjectConfigPath } from "@min-agent/config";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((line?: unknown) => {
    errors.push(String(line));
  });

  afterEach(() => {
    errors.length = 0;
    spy.mockClear();
  });

  it("applies project preferences, ignores a legacy config.json, and lets flags win", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "min-cli-config-"));
    const projectFile = userProjectConfigPath(cwd, homedir());
    const legacyFile = path.join(cwd, ".min", "config.json");
    mkdirSync(path.dirname(projectFile), { recursive: true });
    mkdirSync(path.dirname(legacyFile), { recursive: true });
    writeFileSync(
      projectFile,
      JSON.stringify({
        version: 1,
        provider: "mock",
        model: "from-file",
        runtime: { maxTurns: 7, maxContextTokens: 8192, contextStrategy: "hybrid" },
      }),
    );
    writeFileSync(
      legacyFile,
      JSON.stringify({
        version: 1,
        provider: "legacy",
        model: "legacy-model",
        runtime: { maxTurns: 99 },
      }),
    );
    writeFileSync(
      path.join(cwd, ".min", "settings.json"),
      JSON.stringify({ version: 1, permissions: { bash: "allow", write: "ask" } }),
    );

    try {
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
      expect(errors.some((line) => line.includes(legacyFile) && line.includes("does not change settings"))).toBe(
        true,
      );
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
    } finally {
      rmSync(projectFile, { force: true });
      spy.mockRestore();
    }
  });
});
