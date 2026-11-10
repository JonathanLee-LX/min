import { describe, expect, it } from "vitest";
import {
  applyCommandCompletion,
  buildEffortPickerItems,
  buildModelPickerItems,
  commandPlaceholder,
  commandSuggestions,
  formatCompact,
  formatModelStatus,
  formatQueue,
  NAME_PLACEHOLDER,
  parseCommand,
  resolveModelArgs,
  routeSubmit,
  slashMenuEnter,
  skillCommandSpecs,
  formatHelp,
} from "./commands.js";

describe("routeSubmit", () => {
  it("sends plain text when idle and queues it while busy", () => {
    expect(routeSubmit("hello", false)).toEqual({ type: "send", text: "hello" });
    expect(routeSubmit("hello", true)).toEqual({ type: "queue", text: "hello" });
    expect(routeSubmit("   ", false)).toEqual({ type: "empty" });
  });

  it("keeps read-only commands while busy and blocks session mutations", () => {
    expect(routeSubmit("/help", true)).toEqual({ type: "command", command: { type: "help" } });
    expect(routeSubmit("/context", true).type).toBe("command");
    expect(routeSubmit("/model", false)).toEqual({
      type: "command",
      command: { type: "model-pick" },
    });
    expect(routeSubmit("/model", true)).toEqual({
      type: "command",
      command: { type: "model-pick" },
    });
    expect(routeSubmit("/effort high", true)).toEqual({ type: "busy-blocked", name: "effort" });
    expect(routeSubmit("/name Notice colors", true)).toEqual({
      type: "busy-blocked",
      name: "name",
    });
    expect(routeSubmit("/compact", false)).toEqual({
      type: "command",
      command: { type: "compact" },
    });
    for (const line of ["/resume", "/resume abc", "/new", "/reset"]) {
      expect(routeSubmit(line, true).type).toBe("busy-blocked");
    }
  });

  it("parses the same command shapes as the terminal", () => {
    expect(parseCommand("/nope")).toEqual({ type: "prompt", text: "/nope" });
    expect(parseCommand("/resume")).toEqual({ type: "resume-pick" });
    expect(parseCommand("/open session-1")).toEqual({ type: "resume", id: "session-1" });
    expect(parseCommand("/ctx")).toEqual({ type: "context" });
    expect(parseCommand("/model openai gpt-4.1")).toEqual({
      type: "model-set",
      args: ["openai", "gpt-4.1"],
    });
    expect(parseCommand("/effort high")).toEqual({ type: "effort-set", value: "high" });
    expect(parseCommand("/name Notice colors")).toEqual({
      type: "name-set",
      title: "Notice colors",
    });
    expect(commandPlaceholder("/name ")).toBe(NAME_PLACEHOLDER);
    expect(commandPlaceholder("/model ")).toBeUndefined();
  });

  it("resolves /model args against saved provider names", () => {
    const named = {
      acme: {
        kind: "openai",
        model: "gpt",
        baseUrl: "https://example.test/v1",
        apiKeyEnv: "ACME_API_KEY",
      },
    };
    expect(resolveModelArgs(["acme"], named, { ACME_API_KEY: "sk-test" })).toEqual({
      type: "provider",
      kind: "openai",
      model: "gpt",
      baseURL: "https://example.test/v1",
      apiKey: "sk-test",
    });
    expect(resolveModelArgs(["a", "b", "c"], named)).toMatchObject({ type: "error" });
  });

  it("builds model and effort menus", () => {
    const items = buildModelPickerItems(
      { kind: "openai", model: "gpt-4.1" },
      ["gpt-4.1", "o3"],
      { acme: { kind: "deepseek", model: "deepseek-flash" } },
      (kind, model) => kind === "deepseek" || model === "o3",
    );
    expect(items.map((item) => item.name)).toEqual(["gpt-4.1", "o3", "acme"]);
    expect(items[1]).toMatchObject({ supportsEffort: true, detail: "thinking" });
    expect(buildEffortPickerItems("high").find((item) => item.current)?.value).toBe("high");
    expect(buildEffortPickerItems(undefined).find((item) => item.current)?.value).toBe("default");
  });

  it("formats model, queue, and compact text", () => {
    expect(
      formatModelStatus({
        kind: "deepseek",
        model: "deepseek-flash",
        models: ["deepseek-flash"],
        saved: [],
      }),
    ).toContain("effort (default)");
    expect(formatQueue([])).toBe("queue size=0");
    expect(
      formatCompact({
        summary: "",
        droppedMessageCount: 0,
        keptTurns: 1,
        messageCount: 2,
      }),
    ).toContain("nothing to summarize");
  });

  it("completes slash commands and runs picker commands on enter", () => {
    expect(commandSuggestions("/re").map((command) => command.name)).toEqual(["resume", "reset"]);
    expect(applyCommandCompletion("/resu", 0)).toBe("/resume ");
    expect(applyCommandCompletion("/he", 0)).toBe("/help");
    expect(slashMenuEnter({ name: "resume", hint: "", arg: true, pick: true })).toEqual({
      type: "run",
      line: "/resume",
    });
    expect(slashMenuEnter({ name: "effort", hint: "", arg: true })).toEqual({
      type: "fill",
      text: "/effort ",
    });
  });

  it("lists loaded skills as /name without replacing built-ins", () => {
    const extra = skillCommandSpecs([
      { name: "greeter", description: "Say hello" },
      { name: "help", description: "ignored" },
    ]);
    expect(extra.map((command) => command.name)).toEqual(["greeter"]);
    expect(commandSuggestions("/g", extra).map((command) => command.name)).toEqual([
      "greeter",
    ]);
    expect(applyCommandCompletion("/g", 0, extra)).toBe("/greeter ");
    expect(formatHelp([{ name: "greeter", description: "Say hello" }])).toContain(
      "/greeter",
    );
  });
});
