import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as mindApi from "./index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("mind architecture contracts", () => {
  it("depends on client/runtime/session, not core/tools/providers directly", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual([
      "@min-agent/client",
      "@min-agent/runtime",
      "@min-agent/session",
    ]);
  });

  it("keeps the supervisor free of MinClient", () => {
    const daemon = readFileSync(path.join(ROOT, "src", "daemon.ts"), "utf8");
    expect(daemon).not.toContain("createClient");
    expect(daemon).not.toContain("MinClient");
    expect(daemon).not.toContain(".send(");
  });

  it("exports attach/create/lookup without embedding a client in the supervisor API names", () => {
    expect(typeof mindApi.startMindDaemon).toBe("function");
    expect(typeof mindApi.attachSession).toBe("function");
    expect(typeof mindApi.ensureMind).toBe("function");
    expect(mindApi.MIND_PROTOCOL).toBe(1);
  });
});
