import { describe, expect, it } from "vitest";
import { PERMISSION_TIMEOUT, permissionAnswer, permissionLines } from "./permission-view.js";

describe("permission view", () => {
  const toolCall = { name: "bash", arguments: { command: "ls" } };

  it("shows a tool pattern and the silent timeout", () => {
    const lines = permissionLines({
      reason: "bash runs a command",
      toolCall,
    });
    expect(lines[0]).toBe("Allow tool");
    expect(lines.join("\n")).toContain("bash");
    expect(lines.join("\n")).toContain("this pattern");
    expect(lines.at(-1)).toContain(PERMISSION_TIMEOUT);
  });

  it("shows a root grant separately from the tool", () => {
    const lines = permissionLines({
      reason: "path is outside the sandbox",
      toolCall,
      grantRoot: "/tmp/project",
    });
    expect(lines[0]).toBe("Grant session root");
    expect(lines.join("\n")).toContain("path  /tmp/project");
    expect(lines.join("\n")).toContain("this root");
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
