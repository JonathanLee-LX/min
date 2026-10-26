import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_VERSION,
  loadMinConfig,
  parseConfigDocument,
  projectConfigPath,
  userConfigPath,
} from "./index.js";

describe("config architecture contracts", () => {
  it("pins document version and stable path helpers", () => {
    expect(CONFIG_VERSION).toBe(1);
    expect(userConfigPath("/home/me")).toBe(
      path.join("/home/me", ".config", "min", "config.json"),
    );
    expect(projectConfigPath("/repo")).toBe(
      path.join("/repo", ".min", "config.json"),
    );
  });

  it("loads a project file without rejecting future extension keys", () => {
    const root = mkdtempSync(path.join(tmpdir(), "min-cfg-arch-"));
    mkdirSync(path.join(root, ".min"), { recursive: true });
    writeFileSync(
      projectConfigPath(root),
      JSON.stringify({
        version: 1,
        ui: { theme: "default" },
        pluginBus: { enabled: true },
      }),
    );
    const loaded = loadMinConfig({
      cwd: root,
      userPath: path.join(root, "missing-user.json"),
      env: {},
    });
    expect(loaded.config.ui.theme).toBe("default");
    expect(loaded.config.extensions.pluginBus).toEqual({ enabled: true });
    expect(loaded.config.sources.some((source) => source.includes(".min"))).toBe(true);
  });

  it("never requires permissions or sessions inside config.json", () => {
    const parsed = parseConfigDocument({
      version: 1,
      permissions: { grants: [] },
      sessions: { dir: "./x" },
    });
    expect(parsed.document.extensions?.permissions).toEqual({ grants: [] });
    expect(parsed.document.extensions?.sessions).toEqual({ dir: "./x" });
    expect("permissions" in parsed.document).toBe(false);
  });
});
