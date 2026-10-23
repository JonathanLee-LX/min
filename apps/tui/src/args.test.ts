import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";

describe("tui parseArgs", () => {
  it("parses flags", () => {
    expect(
      parseArgs(["--provider", "deepseek", "--cwd", "/tmp", "-y"]),
    ).toMatchObject({
      provider: "deepseek",
      cwd: "/tmp",
      yes: true,
    });
  });
});
