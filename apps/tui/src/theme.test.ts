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
  it("resolves accent foregrounds without default block fills", () => {
    expect(toneFor("user").background).toBeUndefined();
    expect(toneFor("user").body).toBe("#4e9a57");
    expect(toneFor("user").label).toBe("#4e9a57");
    expect(defaultTheme.chrome.brand).toBe("#4e9a57");
    expect(toneFor("assistant").background).toBeUndefined();
    expect(toneFor("assistant").label).toBeUndefined();
    expect(toneFor("assistant").body).toBeUndefined();
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
    expect(themed.roles.assistant.background).toBeUndefined();
  });

  it("paints notices as peach copy on a raised slate band", () => {
    expect(toneFor("notice")).toMatchObject({
      label: "#fab387",
      body: "#fab387",
      background: "#45475a",
    });
    const rows = paintTranscript(
      [{ key: "n", kind: "notice", text: "legacy config is ignored" }],
      40,
    );
    expect(rows[0]?.gutter).toBe("note ");
    expect(rows[0]?.body).toBe("legacy config is ignored ");
    expect(rows[0]?.text.length).toBeLessThan(40);
  });

  it("keeps default user/assistant roles free of background fills", () => {
    expect(defaultTheme.roles.user.background).toBeUndefined();
    expect(defaultTheme.roles.assistant.background).toBeUndefined();
    expect(defaultTheme.roles.user.body).toMatch(/^#/);
    expect(defaultTheme.roles.assistant.body).toBeUndefined();
  });

  it("styles thinking and tools in different accents", () => {
    const tone = toneFor("thinking");
    expect(tone.italicBody).toBe(true);
    expect(tone.dimBody).toBe(false);
    expect(tone.body).toBe("#7f849c");
    expect(toneFor("tool").body).toBe("#89dceb");
    expect(toneFor("tool-result").body).toBe("#a6adc8");
    expect(toneFor("assistant").body).toBeUndefined();
    expect(toneFor("assistant").italicBody).toBe(false);
  });

  it("exposes markdown span accents", () => {
    expect(defaultTheme.markdown.code).toBe("#94e2d5");
    expect(defaultTheme.markdown.codeBackground).toBe("#313244");
    expect(defaultTheme.markdown.link).toBe("#89dceb");
    const custom = createTheme({ markdown: { code: "#ff0" } });
    expect(custom.markdown.code).toBe("#ff0");
    expect(custom.markdown.link).toBe(defaultTheme.markdown.link);
    expect(custom.markdown.codeBackground).toBe(defaultTheme.markdown.codeBackground);
  });
});
