import { describe, expect, it } from "vitest";
import { commandSelectRows } from "./CommandSelect.js";
import { modelSelectRows, modelSelectWindow } from "./ModelSelect.js";
import { permissionPromptRows } from "./PermissionPrompt.js";
import { sessionSelectRows, sessionSelectWindow } from "./SessionSelect.js";

describe("commandSelectRows", () => {
  it("caps visible rows at 8", () => {
    expect(commandSelectRows(0)).toBe(0);
    expect(commandSelectRows(3)).toBe(3);
    expect(commandSelectRows(12)).toBe(8);
  });
});

describe("sessionSelectRows", () => {
  it("reserves a hint row plus up to 8 sessions", () => {
    expect(sessionSelectRows(0)).toBe(1);
    expect(sessionSelectRows(3)).toBe(4);
    expect(sessionSelectRows(12)).toBe(9);
  });

  it("keeps the selected session inside the visible window", () => {
    expect(sessionSelectWindow(0, 0)).toEqual({ start: 0, end: 0 });
    expect(sessionSelectWindow(3, 2)).toEqual({ start: 0, end: 3 });
    expect(sessionSelectWindow(12, 0)).toEqual({ start: 0, end: 8 });
    expect(sessionSelectWindow(12, 7)).toEqual({ start: 0, end: 8 });
    expect(sessionSelectWindow(12, 8)).toEqual({ start: 1, end: 9 });
    expect(sessionSelectWindow(12, 11)).toEqual({ start: 4, end: 12 });
  });
});

describe("modelSelectRows", () => {
  it("reserves a hint row plus up to 8 models", () => {
    expect(modelSelectRows(0)).toBe(1);
    expect(modelSelectRows(3)).toBe(4);
    expect(modelSelectRows(12)).toBe(9);
  });

  it("keeps the selected model inside the visible window", () => {
    expect(modelSelectWindow(0, 0)).toEqual({ start: 0, end: 0 });
    expect(modelSelectWindow(3, 2)).toEqual({ start: 0, end: 3 });
    expect(modelSelectWindow(12, 0)).toEqual({ start: 0, end: 8 });
    expect(modelSelectWindow(12, 8)).toEqual({ start: 1, end: 9 });
    expect(modelSelectWindow(12, 11)).toEqual({ start: 4, end: 12 });
  });
});

describe("permissionPromptRows", () => {
  it("reserves margin, details, confirm, and hint", () => {
    expect(permissionPromptRows(null)).toBe(0);
    expect(
      permissionPromptRows({
        reason: "bash runs a command",
        toolCall: { name: "bash", arguments: { command: "ls" } },
      }),
    ).toBe(1 + 3 + 2);
  });
});
