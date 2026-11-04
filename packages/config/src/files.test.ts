import { describe, expect, it } from "vitest";
import {
  keybindingDocument,
  parseAuthFile,
  parseCronFile,
  parseKeybindingFile,
  parseMcpFile,
  parseProvidersFile,
  parseSettingsFile,
} from "./files.js";
import { parseConfigDocument } from "./parse.js";

describe("parseKeybindingFile", () => {
  it("reads bindings, keybindings, or a flat chord map", () => {
    expect(parseKeybindingFile({ version: 1, bindings: { enter: "newline" } }).value).toEqual({
      enter: "newline",
    });
    expect(parseKeybindingFile({ keybindings: { "shift+enter": "submit" } }).value).toEqual({
      "shift+enter": "submit",
    });
    expect(parseKeybindingFile({ enter: "newline", version: 1 }).value).toEqual({
      enter: "newline",
    });
  });

  it("drops non-strings and rejects a non-object root", () => {
    expect(parseKeybindingFile({ bindings: { enter: "newline", esc: 1, ok: true } }).value).toEqual({
      enter: "newline",
    });
    expect(parseKeybindingFile([]).warnings).toEqual(["keybindings root must be an object"]);
    expect(parseKeybindingFile(null).value).toEqual({});
  });

  it("warns when the file version is newer", () => {
    const parsed = parseKeybindingFile({ version: 4, bindings: { enter: "submit" } });
    expect(parsed.value.enter).toBe("submit");
    expect(parsed.warnings[0]).toMatch(/keybindings version 4 is newer/);
  });

  it("turns a non-empty map into a sparse preference layer", () => {
    expect(keybindingDocument({})).toBeUndefined();
    expect(keybindingDocument({ enter: "newline" })?.ui?.keybindings).toEqual({
      enter: "newline",
    });
  });
});

describe("parseSettingsFile", () => {
  it("keeps only allow, ask, and deny permission modes", () => {
    const parsed = parseSettingsFile({
      permissions: { bash: "allow", write: "sometimes", read: "deny", extra: "ask" },
      mcp: { enabled: false, extra: true },
      hooks: { start: ["lint"] },
    });
    expect(parsed.value.permissions).toEqual({ bash: "allow", read: "deny" });
    expect(parsed.value.mcp).toEqual({ enabled: false });
    expect(parsed.value.hooks).toEqual({ start: ["lint"] });
  });

  it("drops a permission block and an mcp policy that have no usable fields", () => {
    const parsed = parseSettingsFile({
      permissions: { bash: "yes" },
      mcp: { enabled: "false" },
    });
    expect(parsed.value.permissions).toBeUndefined();
    expect(parsed.value.mcp).toBeUndefined();
  });

  it("keeps unknown keys under extensions", () => {
    const parsed = parseSettingsFile({
      version: 9,
      plugins: { on: true },
      extensions: { kept: 1 },
    });
    expect(parsed.value.extensions).toEqual({ kept: 1, plugins: { on: true } });
    expect(parsed.warnings.some((warning) => /unknown settings key "plugins"/.test(warning))).toBe(
      true,
    );
    expect(parsed.warnings.some((warning) => /settings version 9 is newer/.test(warning))).toBe(
      true,
    );
  });

  it("rejects a non-object root", () => {
    expect(parseSettingsFile("nope").warnings).toEqual(["settings root must be an object"]);
  });
});

describe("parseAuthFile", () => {
  it("keeps string keys and drops everything else", () => {
    const parsed = parseAuthFile({
      version: 1,
      keys: { OPENAI_API_KEY: "sk-test", n: 1, empty: "" },
      provider: "should-not-leak",
    });
    expect(parsed.value.keys).toEqual({ OPENAI_API_KEY: "sk-test", empty: "" });
    expect(parsed.warnings).toEqual([]);
  });

  it("returns an empty key map for a bad root", () => {
    expect(parseAuthFile([]).value.keys).toEqual({});
    expect(parseAuthFile([]).warnings).toEqual(["auth root must be an object"]);
    expect(parseAuthFile({}).value.keys).toEqual({});
  });
});

describe("parseProvidersFile", () => {
  it("requires kind and trims optional fields", () => {
    const parsed = parseProvidersFile({
      version: 1,
      providers: {
        acme: {
          kind: " openai ",
          model: " gpt ",
          baseUrl: " https://example.test ",
          apiKeyEnv: " ACME_KEY ",
          apiKey: "do-not-keep",
        },
        blank: { kind: "  " },
        missing: { model: "x" },
      },
    });
    expect(parsed.value).toEqual({
      acme: {
        kind: "openai",
        model: "gpt",
        baseUrl: "https://example.test",
        apiKeyEnv: "ACME_KEY",
      },
    });
    expect(parsed.warnings).toEqual([
      'provider "blank" needs a kind string',
      'provider "missing" needs a kind string',
    ]);
  });

  it("rejects a non-object root", () => {
    expect(parseProvidersFile(1).warnings).toEqual(["providers root must be an object"]);
  });
});

describe("parseMcpFile", () => {
  it("accepts stdio command servers and sse url servers", () => {
    const parsed = parseMcpFile({
      mcpServers: {
        docs: {
          command: "npx",
          args: ["docs", 1, "serve"],
          env: { TOKEN: "t", n: 2 },
        },
        remote: { url: " https://example.test/sse " },
        both: { transport: "sse", url: "https://example.test/mcp", command: "ignored" },
        stdioWins: { transport: "stdio", command: "local", url: "https://example.test/nope" },
      },
    });
    expect(parsed.value).toEqual([
      {
        name: "docs",
        transport: "stdio",
        command: "npx",
        args: ["docs", "serve"],
        env: { TOKEN: "t" },
      },
      { name: "remote", transport: "sse", url: "https://example.test/sse" },
      { name: "both", transport: "sse", url: "https://example.test/mcp" },
      { name: "stdioWins", transport: "stdio", command: "local" },
    ]);
  });

  it("reads a servers table and warns on entries with neither command nor url", () => {
    const parsed = parseMcpFile({
      version: 3,
      servers: { empty: {}, sseOnly: { transport: "sse" }, named: { command: "ok" } },
    });
    expect(parsed.value.map((server) => server.name)).toEqual(["named"]);
    expect(parsed.warnings).toEqual([
      "mcp version 3 is newer than supported 1",
      'mcp server "empty" needs a command or url',
      'mcp server "sseOnly" needs a command or url',
    ]);
  });

  it("rejects a non-object root", () => {
    expect(parseMcpFile(null).warnings).toEqual(["mcp root must be an object"]);
  });
});

describe("parseCronFile", () => {
  it("keeps jobs with an id and skips the rest", () => {
    const parsed = parseCronFile({
      jobs: [
        { id: " daily ", schedule: " 0 9 * * * ", prompt: "digest", enabled: false },
        { id: "   " },
        { schedule: "0 * * * *" },
        "nope",
        { id: "bare" },
      ],
    });
    expect(parsed.value).toEqual([
      { id: "daily", schedule: "0 9 * * *", prompt: "digest", enabled: false },
      { id: "bare" },
    ]);
  });

  it("returns no jobs when the jobs array is missing", () => {
    expect(parseCronFile({ version: 1 }).value).toEqual([]);
    expect(parseCronFile([]).warnings).toEqual(["cron jobs root must be an object"]);
  });
});

describe("parseConfigDocument edges", () => {
  it("rejects a non-object root", () => {
    const parsed = parseConfigDocument([]);
    expect(parsed.document.provider).toBeUndefined();
    expect(parsed.warnings[0]).toMatch(/config root must be an object/);
  });

  it("treats a missing or invalid version as 1", () => {
    expect(parseConfigDocument({ provider: "mock" }).warnings[0]).toMatch(/missing version/);
    expect(parseConfigDocument({ version: "1", provider: "mock" }).warnings[0]).toMatch(
      /invalid version/,
    );
    expect(parseConfigDocument({ version: 0 }).warnings[0]).toMatch(/invalid version/);
  });

  it("drops blank scalars and non-positive runtime numbers", () => {
    const parsed = parseConfigDocument({
      version: 1,
      provider: "  ",
      model: " m ",
      runtime: { maxTurns: 0, maxContextTokens: 2.5, contextStrategy: " hybrid ", sessionDir: " .min/sessions " },
      ui: { theme: "  ", keybindings: { " enter ": " submit ", "": "nope", esc: 1 } },
    });
    expect(parsed.document.provider).toBeUndefined();
    expect(parsed.document.model).toBe("m");
    expect(parsed.document.runtime).toEqual({
      contextStrategy: "hybrid",
      sessionDir: ".min/sessions",
    });
    expect(parsed.document.ui?.theme).toBeUndefined();
    expect(parsed.document.ui?.keybindings).toEqual({ enter: "submit" });
  });

  it("keeps a known reasoning effort and warns on an unknown one", () => {
    expect(parseConfigDocument({ version: 1, reasoningEffort: " High " }).document.reasoningEffort).toBe(
      "high",
    );
    const rejected = parseConfigDocument({ version: 1, reasoningEffort: "turbo" });
    expect(rejected.document.reasoningEffort).toBeUndefined();
    expect(rejected.warnings.some((warning) => warning.includes("reasoningEffort"))).toBe(true);
  });
});
