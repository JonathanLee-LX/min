import { describe, expect, it } from "vitest";
import { formatVersionLine, packageVersion } from "./version.js";

describe("version", () => {
  it("reads a semver-ish version from package.json", () => {
    expect(packageVersion()).toMatch(/\d+\.\d+/);
    expect(formatVersionLine()).toMatch(/^min \d/);
    expect(formatVersionLine()).toContain("node");
  });
});
