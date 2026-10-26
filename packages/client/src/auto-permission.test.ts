import { describe, expect, it } from "vitest";
import { createAutoPermissionApprover } from "./auto-permission.js";

const tool = { type: "tool_call" as const, id: "1", name: "bash", arguments: {} };

describe("createAutoPermissionApprover", () => {
  it("yes mode allows tools once but denies root grants by default", () => {
    const approve = createAutoPermissionApprover({ mode: "yes" });
    expect(approve({ toolCall: tool, reason: "bash" })).toBe("allow");
    expect(
      approve({
        toolCall: tool,
        reason: "outside",
        grantRoot: "/tmp/other",
      }),
    ).toBe("deny");
  });

  it("yes mode can allow root grants when opted in", () => {
    const approve = createAutoPermissionApprover({
      mode: "yes",
      allowRootGrant: true,
    });
    expect(
      approve({
        toolCall: tool,
        reason: "outside",
        grantRoot: "/tmp/other",
      }),
    ).toBe("allow");
  });

  it("auto mode always returns allow_session including root grants", () => {
    const approve = createAutoPermissionApprover({ mode: "auto" });
    expect(approve({ toolCall: tool, reason: "skill escape" })).toBe(
      "allow_session",
    );
    expect(
      approve({
        toolCall: tool,
        reason: "outside",
        grantRoot: "/tmp/other",
      }),
    ).toBe("allow_session");
  });
});
