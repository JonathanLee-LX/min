import { describe, expect, it } from "vitest";
import { paintTranscript } from "./paint.js";
import {
  createTheme,
  defaultTheme,
  getTheme,
  listThemes,
  registerTheme,
  themeFromConfig,
  toneFor,
} from "./theme.js";

describe("theme", () => {
  it("resolves high-contrast role colors from the active theme", () => {
    expect(toneFor("user").background).toBe("#a6e3a1");
    expect(toneFor("user").body).toBe("#11111b");
    expect(toneFor("assistant").background).toBe("#89b4fa");
    expect(toneFor("assistant").body).toBe("#11111b");
    const custom = createTheme({
      id: "ink",
      name: "Ink",
      roles: {
        user: { background: "cyan", body: "black", label: "black" },
        assistant: { background: "blackBright", body: "white", label: "white" },
      },
      frames: { chatBar: "| " },
    });
    expect(toneFor("user", custom)).toMatchObject({
      background: "cyan",
      body: "black",
    });
    expect(toneFor("tool", custom).body).toBe(defaultTheme.roles.tool.body);
    const rows = paintTranscript([{ key: "u", kind: "user", text: "hi" }], 20, custom);
    expect(rows[0]?.gutter).toBe("| ");
  });

  it("registers themes for lookup by id", () => {
    const custom = createTheme({ id: "test-theme", name: "Test" });
    registerTheme(custom);
    expect(listThemes()).toContain("test-theme");
    expect(getTheme("test-theme").name).toBe("Test");
    expect(() => getTheme("missing-theme")).toThrow(/Unknown theme/);
  });

  it("builds a theme from shared config ui overrides", () => {
    const themed = themeFromConfig({
      theme: "default",
      themeOverrides: {
        frames: { chatBar: "> " },
        roles: { user: { background: "cyan", body: "black", label: "black" } },
      },
    });
    expect(themed.frames.chatBar).toBe("> ");
    expect(themed.roles.user.background).toBe("cyan");
    expect(themed.roles.assistant.background).toBe("#89b4fa");
  });

  it("keeps dark body text on soft user/assistant fills for contrast", () => {
    const user = defaultTheme.roles.user;
    const assistant = defaultTheme.roles.assistant;
    expect(user.background).toMatch(/^#/);
    expect(assistant.background).toMatch(/^#/);
    expect(user.body).toBe("#11111b");
    expect(assistant.body).toBe("#11111b");
    expect(user.body).not.toBe(user.background);
    expect(assistant.body).not.toBe(assistant.background);
  });
});
