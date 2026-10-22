import { describe, expect, it } from "vitest";
import { mcp } from "./index.js";

describe("mcp extension factory", () => {
  it("creates a named extension", () => {
    const ext = mcp({
      servers: [],
    });
    expect(ext.name).toBe("mcp");
  });
});
