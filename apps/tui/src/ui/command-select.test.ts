import { describe, expect, it } from "vitest";
import { commandSelectRows } from "./CommandSelect.js";
import { permissionPromptRows } from "./PermissionPrompt.js";

describe("commandSelectRows", () => {
  it("caps visible rows at 8", () => {
    expect(commandSelectRows(0)).toBe(0);
    expect(commandSelectRows(3)).toBe(3);
    expect(commandSelectRows(12)).toBe(8);
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
