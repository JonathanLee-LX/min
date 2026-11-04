import { describe, expect, it } from "vitest";
import {
  applyCommandCompletion,
  commandGhost,
  commandPlaceholder,
  NAME_PLACEHOLDER,
  commandSuggestions,
  cycleCommandIndex,
  formatCompact,
  formatModelStatus,
  formatQueue,
  parseTuiCommand,
  resolveModelArgs,
  routeSubmit,
  selectCommandCompletion,
} from "./commands.js";

describe("routeSubmit", () => {
  it("sends plain text when idle and queues it while busy", () => {
    expect(routeSubmit("hello", false)).toEqual({ type: "send", text: "hello" });
    expect(routeSubmit("hello", true)).toEqual({ type: "queue", text: "hello" });
    expect(routeSubmit("   ", false)).toEqual({ type: "empty" });
  });

  it("keeps read-only commands while busy and blocks session mutations", () => {
    expect(routeSubmit("/help", true)).toEqual({ type: "command", command: { type: "help" } });
    expect(routeSubmit("/context", true)).toEqual({
      type: "command",
      command: { type: "context" },
    });
    expect(routeSubmit("/version", true)).toEqual({
      type: "command",
      command: { type: "version" },
    });
    expect(routeSubmit("/queue", true)).toEqual({ type: "command", command: { type: "queue" } });
    expect(routeSubmit("/thinking", true)).toEqual({ type: "command", command: { type: "thinking" } });
    expect(routeSubmit("/think", false)).toEqual({ type: "command", command: { type: "thinking" } });
    expect(routeSubmit("/session", true).type).toBe("command");
    expect(routeSubmit("/sessions", true).type).toBe("command");
    expect(routeSubmit("/dense keep this", true)).toEqual({
      type: "command",
      command: { type: "dense", text: "keep this" },
    });
    expect(routeSubmit("/model", true)).toEqual({ type: "command", command: { type: "model" } });
    expect(routeSubmit("/effort", true)).toEqual({ type: "command", command: { type: "effort" } });
    expect(routeSubmit("/exit", true)).toEqual({ type: "command", command: { type: "exit" } });
    expect(routeSubmit("/quit", false)).toEqual({ type: "command", command: { type: "exit" } });
    expect(routeSubmit("/q", false)).toEqual({ type: "command", command: { type: "exit" } });
    expect(commandSuggestions("/qui").map((command) => command.name)).toEqual(["quit"]);
    for (const line of [
      "/resume abc",
      "/resume",
      "/open abc",
      "/new",
      "/reset",
      "/compact",
      "/model gpt-4.1",
      "/effort high",
      "/name",
      "/name Notice colors",
    ]) {
      expect(routeSubmit(line, true).type).toBe("busy-blocked");
    }
    expect(routeSubmit("/model gpt-4.1", true)).toEqual({
      type: "busy-blocked",
      name: "model",
    });
    expect(routeSubmit("/effort high", true)).toEqual({
      type: "busy-blocked",
      name: "effort",
    });
    expect(routeSubmit("/name", true)).toEqual({
      type: "busy-blocked",
      name: "name",
    });
    expect(routeSubmit("/name Notice colors", true)).toEqual({
      type: "busy-blocked",
      name: "name",
    });
    expect(routeSubmit("/compact", false)).toEqual({
      type: "command",
      command: { type: "compact" },
    });
  });

  it("treats an unknown slash line as a prompt", () => {
    expect(parseTuiCommand("/nope")).toEqual({ type: "prompt", text: "/nope" });
    expect(parseTuiCommand("/resume")).toEqual({ type: "resume-pick" });
    expect(parseTuiCommand("/resume session-1")).toEqual({
      type: "resume",
      id: "session-1",
    });
    expect(parseTuiCommand("/open")).toEqual({ type: "resume-pick" });
    expect(parseTuiCommand("/open session-1")).toEqual({
      type: "resume",
      id: "session-1",
    });
    expect(parseTuiCommand("/dense")).toEqual({ type: "dense-usage" });
    expect(parseTuiCommand("/ctx")).toEqual({ type: "context" });
    expect(parseTuiCommand("/v")).toEqual({ type: "version" });
    expect(parseTuiCommand("/model")).toEqual({ type: "model" });
    expect(parseTuiCommand("/model gpt-4.1")).toEqual({
      type: "model-set",
      args: ["gpt-4.1"],
    });
    expect(parseTuiCommand("/model openai gpt-4.1")).toEqual({
      type: "model-set",
      args: ["openai", "gpt-4.1"],
    });
    expect(parseTuiCommand("/effort")).toEqual({ type: "effort" });
    expect(parseTuiCommand("/effort high")).toEqual({ type: "effort-set", value: "high" });
    expect(parseTuiCommand("/name")).toEqual({ type: "name" });
    expect(parseTuiCommand("/name Notice colors")).toEqual({
      type: "name-set",
      title: "Notice colors",
    });
    expect(commandPlaceholder("/name ")).toBe(NAME_PLACEHOLDER);
    expect(commandPlaceholder("/NAME  ")).toBe(NAME_PLACEHOLDER);
    expect(commandPlaceholder("/name")).toBeUndefined();
    expect(commandPlaceholder("/name Notice colors")).toBeUndefined();
    expect(commandPlaceholder("/model ")).toBeUndefined();
  });

  it("resolves /model args against saved provider names", () => {
    const named = {
      acme: { kind: "openai", model: "gpt", baseUrl: "https://example.test/v1", apiKeyEnv: "ACME_API_KEY" },
    };
    expect(resolveModelArgs([], named)).toEqual({ type: "show" });
    expect(resolveModelArgs(["gpt-4.1"], named)).toEqual({ type: "model", model: "gpt-4.1" });
    expect(resolveModelArgs(["openai", "o3"], named)).toEqual({
      type: "provider",
      kind: "openai",
      model: "o3",
    });
    expect(resolveModelArgs(["acme"], named, { ACME_API_KEY: "sk-test" })).toEqual({
      type: "provider",
      kind: "openai",
      model: "gpt",
      baseURL: "https://example.test/v1",
      apiKey: "sk-test",
    });
    expect(resolveModelArgs(["a", "b", "c"], named)).toEqual({
      type: "error",
      message: "usage: /model <model> | /model <provider> <model>",
    });
  });

  it("formats the model status line", () => {
    expect(
      formatModelStatus({
        kind: "deepseek",
        model: "deepseek-flash",
        models: ["deepseek-flash"],
        saved: [],
      }),
    ).toBe("provider deepseek\nmodel deepseek-flash\neffort (default)\nmodels: deepseek-flash");
  });

  it("formats queue and compact results", () => {
    expect(formatQueue([])).toBe("queue size=0");
    expect(formatQueue(["hello"])).toContain("[0] hello");
    expect(
      formatCompact({
        summary: "",
        droppedMessageCount: 0,
        keptTurns: 1,
        messageCount: 2,
      }),
    ).toContain("nothing to summarize");
  });
});

describe("command completion", () => {
  it("lists slash matches and completes the selected one", () => {
    expect(commandSuggestions("")).toEqual([]);
    expect(commandSuggestions("hello")).toEqual([]);
    expect(commandSuggestions("/").map((command) => command.name)).toContain("help");
    expect(commandSuggestions("/he").map((command) => command.name)).toEqual(["help"]);
    expect(commandSuggestions("/con").map((command) => command.name)).toEqual(["context"]);
    expect(commandSuggestions("/ver").map((command) => command.name)).toEqual(["version"]);
    expect(commandSuggestions("/re").map((command) => command.name)).toEqual([
      "resume",
      "reset",
    ]);
    expect(commandSuggestions("/resu").map((command) => command.name)).toEqual(["resume"]);
    expect(commandSuggestions("/s").map((command) => command.name)).toEqual([
      "session",
      "sessions",
    ]);
    expect(commandSuggestions("/resume x")).toEqual([]);
    expect(applyCommandCompletion("/he", 0)).toBe("/help");
    expect(applyCommandCompletion("/resu", 0)).toBe("/resume ");
    expect(applyCommandCompletion("/s", 1)).toBe("/sessions");
    expect(commandGhost("/s", 0)).toBe("ession");
    expect(commandGhost("/s", 1)).toBe("essions");
  });

  it("fills the selected command when browsing without a trailing space", () => {
    expect(selectCommandCompletion("/", 0)).toBe("/help");
    expect(selectCommandCompletion("/s", 1)).toBe("/sessions");
    expect(selectCommandCompletion("/resu", 0)).toBe("/resume");
    expect(cycleCommandIndex(0, 3, "down")).toBe(1);
    expect(cycleCommandIndex(0, 3, "up")).toBe(2);
    expect(cycleCommandIndex(2, 3, "down")).toBe(0);
  });
});
