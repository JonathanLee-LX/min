import { describe, expect, it } from "vitest";
import { commandSelectRows } from "./CommandSelect.js";
import { permissionPromptRows } from "./PermissionPrompt.js";
import { sessionSelectRows } from "./SessionSelect.js";

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
