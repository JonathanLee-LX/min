import { describe, expect, it } from "vitest";
import { combinedHelpText, resolveMinMode } from "./dispatch.js";

describe("resolveMinMode", () => {
  it("defaults to the TUI", () => {
    expect(resolveMinMode([])).toBe("tui");
    expect(resolveMinMode(["--provider", "mock", "--cwd", "/tmp"])).toBe("tui");
  });

  it("routes -p / -i / --list-sessions to the CLI", () => {
    expect(resolveMinMode(["-p", "hello"])).toBe("cli");
    expect(resolveMinMode(["--prompt", "hello"])).toBe("cli");
    expect(resolveMinMode(["--prompt=hello"])).toBe("cli");
    expect(resolveMinMode(["-i"])).toBe("cli");
    expect(resolveMinMode(["--list-sessions"])).toBe("cli");
  });

  it("shows combined help for bare -h", () => {
    expect(resolveMinMode(["-h"])).toBe("help");
    expect(resolveMinMode(["--help"])).toBe("help");
    expect(combinedHelpText()).toContain('min -p "your prompt"');
    expect(combinedHelpText()).toContain("min --version");
  });

  it("prints version for --version without opening the TUI", () => {
    expect(resolveMinMode(["--version"])).toBe("version");
    expect(resolveMinMode(["-v"])).toBe("version");
    expect(resolveMinMode(["-V"])).toBe("version");
    expect(resolveMinMode(["--provider", "mock", "--version"])).toBe("version");
  });

  it("rejects bare positionals without -p", () => {
    expect(() => resolveMinMode(["hello"])).toThrow(/min -p/);
  });
});
