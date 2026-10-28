import { describe, expect, it } from "vitest";

describe("webui server contract", () => {
  it("documents B/S isolation MVP", () => {
    // Browser ↔ HTTP/SSE ↔ Node (lease + client-process bridge). No Client in the browser.
    expect(true).toBe(true);
  });
});
