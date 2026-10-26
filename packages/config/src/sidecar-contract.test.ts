import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultSessionDir,
  documentFromEnv,
  parseConfigDocument,
  permissionRulesPath,
} from "./index.js";

describe("config sidecar contracts", () => {
  it("points sidecars at .min paths outside config.json", () => {
    expect(permissionRulesPath("/repo")).toBe(
      path.join("/repo", ".min", "permissions.json"),
    );
    expect(defaultSessionDir("/repo")).toBe(
      path.join("/repo", ".min", "sessions"),
    );
  });

  it("never promotes permissions or sessions into first-class config fields", () => {
    const parsed = parseConfigDocument({
      version: 1,
      permissions: { grants: [{ kind: "tool", name: "bash" }] },
      sessions: { dir: "./custom" },
    });
    expect(Object.keys(parsed.document).sort()).toEqual(
      ["extensions", "version"].sort(),
    );
    expect(parsed.document.extensions?.permissions).toEqual({
      grants: [{ kind: "tool", name: "bash" }],
    });
    expect(parsed.document.extensions?.sessions).toEqual({ dir: "./custom" });
  });

  it("maps MIN_* env keys into sparse document layers", () => {
    const doc = documentFromEnv({
      MIN_THEME: "forest",
      MIN_MAX_TURNS: "9",
      MIN_MAX_CONTEXT_TOKENS: "32000",
      MIN_CONTEXT_STRATEGY: "hybrid",
      MIN_PROVIDER: "openai",
      MIN_MODEL: "gpt-test",
    });
    expect(doc).toMatchObject({
      ui: { theme: "forest" },
      runtime: {
        maxTurns: 9,
        maxContextTokens: 32_000,
        contextStrategy: "hybrid",
      },
      provider: "openai",
      model: "gpt-test",
    });
  });
});
