import { describe, expect, it } from "vitest";
import { parseToml } from "./toml.js";

describe("parseToml", () => {
  it("reads Codex-style tables, inline maps, and comments", () => {
    const parsed = parseToml(`
# comment
model = "gpt-5"
model_provider = "acme"
model_reasoning_effort = "high"

[mcp_servers.docs]
command = "npx"
args = ["-y", "docs"]
env = { TOKEN = "t", OTHER = "x" }
enabled = true

[mcp_servers.remote]
url = "https://example.test/mcp"

[model_providers.acme]
name = "Acme"
base_url = "https://example.test/v1"
env_key = "ACME_API_KEY"
wire_api = "chat"
`);
    expect(parsed.model).toBe("gpt-5");
    expect(parsed.model_provider).toBe("acme");
    expect(parsed.mcp_servers).toEqual({
      docs: {
        command: "npx",
        args: ["-y", "docs"],
        env: { TOKEN: "t", OTHER: "x" },
        enabled: true,
      },
      remote: { url: "https://example.test/mcp" },
    });
    expect(parsed.model_providers).toEqual({
      acme: {
        name: "Acme",
        base_url: "https://example.test/v1",
        env_key: "ACME_API_KEY",
        wire_api: "chat",
      },
    });
  });

  it("rejects array-of-tables", () => {
    expect(() => parseToml("[[skills.config]]\npath = 'x'\n")).toThrow(/array-of-tables/);
  });
});
