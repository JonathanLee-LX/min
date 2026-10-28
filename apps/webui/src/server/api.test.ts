import { describe, expect, it } from "vitest";

describe("webui server contract", () => {
  it("documents B/S isolation MVP", () => {
    // Browser ↔ HTTP/SSE ↔ this process ↔ session socket. No Client in the browser.
    expect(true).toBe(true);
  });
});
