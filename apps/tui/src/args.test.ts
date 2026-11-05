import { describe, expect, it } from "vitest";
import { helpText, parseArgs } from "./args.js";

describe("tui parseArgs", () => {
  it("parses flags", () => {
    expect(
      parseArgs(["--provider", "deepseek", "--cwd", "/tmp", "-y"]),
    ).toMatchObject({
      provider: "deepseek",
      cwd: "/tmp",
      yes: true,
    });
    expect(parseArgs(["--version"])).toMatchObject({ version: true });
    expect(parseArgs(["-v"])).toMatchObject({ version: true });
  });

  it("parses --auto and implies yes", () => {
    expect(parseArgs(["--auto"])).toMatchObject({ auto: true, yes: true });
  });

  it("parses --theme", () => {
    expect(parseArgs(["--theme", "default"])).toMatchObject({ theme: "default" });
    expect(helpText()).toContain("--theme");
  });

  it("documents session commands and multiline keys", () => {
    const help = helpText();
    expect(help).toContain("/sessions");
    expect(help).toContain("/resume");
    expect(help).toContain("/context");
    expect(help).toContain("/version");
    expect(help).toContain("--version");
    expect(help).toContain("/model");
    expect(help).toContain("Shift+Enter");
    expect(help).toContain("Alt+Enter");
    expect(help).toContain("keybindings.json");
    expect(help).toContain("PageUp/PageDown");
    expect(help).toContain("Ctrl+O");
  });
});
