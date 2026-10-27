import { describe, expect, it } from "vitest";
import {
  PERMISSION_TIMEOUT,
  permissionAnswer,
  permissionDetailLines,
  permissionLines,
} from "./permission-view.js";

describe("permission view", () => {
  const toolCall = { name: "bash", arguments: { command: "ls" } };

  it("shows tool details without key chrome", () => {
    const lines = permissionDetailLines({
      reason: "bash runs a command",
      toolCall,
    });
    expect(lines[0]).toBe("Allow tool");
    expect(lines.join("\n")).toContain("bash");
    expect(lines.join("\n")).not.toContain("[y]");
  });

  it("shows a root grant separately from the tool", () => {
    const lines = permissionDetailLines({
      reason: "path is outside the sandbox",
      toolCall,
      grantRoot: "/tmp/project",
    });
    expect(lines[0]).toBe("Grant session root");
    expect(lines.join("\n")).toContain("path  /tmp/project");
  });

  it("keeps legacy permissionLines for the silent timeout copy", () => {
    const lines = permissionLines({
      reason: "bash runs a command",
      toolCall,
    });
    expect(lines.join("\n")).toContain("this pattern");
    expect(lines.at(-1)).toContain(PERMISSION_TIMEOUT);
  });

  it("maps y/n/a and the longer words", () => {
    expect(permissionAnswer("y")).toBe("allow");
    expect(permissionAnswer("YES")).toBe("allow");
    expect(permissionAnswer("n")).toBe("deny");
    expect(permissionAnswer("no")).toBe("deny");
    expect(permissionAnswer("a")).toBe("allow_session");
    expect(permissionAnswer("always")).toBe("allow_session");
    expect(permissionAnswer("maybe")).toBeNull();
  });
});
