import type { UiConfig } from "@min-agent/config";
import type { LogKind } from "./transcript.js";

/**
 * Visual tokens for the TUI.
 *
 * Themes come from `@min-agent/config` (`ui.theme` / `ui.themeOverrides`),
 * then `--theme` / `MIN_THEME`. Hosts may also {@link registerTheme}.
 */

/** Ink/chalk color name, or a hex string when the host supports it. */
export type ThemeColor = string;

export interface RoleStyle {
  label?: ThemeColor;
  body?: ThemeColor;
  background?: ThemeColor;
  dimLabel?: boolean;
  dimBody?: boolean;
  /** When true, body spans render in italic (e.g. reasoning). */
  italicBody?: boolean;
}

export interface FrameStyle {
  /** Left bar on user / assistant / composer rows. */
  chatBar: string;
  /** Marker before a tool call. */
  toolMarker: string;
  /** Indent before tool output. */
  toolResult: string;
  /** Fixed width for sys / note / err labels. */
  chromeWidth: number;
}

export interface ActivityStyle {
  thinking: ThemeColor;
  writing: ThemeColor;
  tool: ThemeColor;
  continuing: ThemeColor;
  approval: ThemeColor;
}

export interface ChromeStyle {
  /**
   * Primary theme accent — MIN banner, composer rules, and default brand
   * chrome. Soft mint green by default.
   */
  brand: ThemeColor;
  error: ThemeColor;
  permission: ThemeColor;
  completeSelected: ThemeColor;
  statusDim: boolean;
}

/** Colors for Markdown inline tones inside assistant (and similar) body text. */
export interface MarkdownStyle {
  strong?: ThemeColor;
  em?: ThemeColor;
  code?: ThemeColor;
  /** Background behind inline/fenced code so it reads as a code chip. */
  codeBackground?: ThemeColor;
  link?: ThemeColor;
}

export interface TuiTheme {
  id: string;
  name: string;
  roles: Record<LogKind, RoleStyle>;
  frames: FrameStyle;
  activity: ActivityStyle;
  chrome: ChromeStyle;
  markdown: MarkdownStyle;
}

export type ThemeOverrides = {
  id?: string;
  name?: string;
  roles?: Partial<Record<LogKind, Partial<RoleStyle>>>;
  frames?: Partial<FrameStyle>;
  activity?: Partial<ActivityStyle>;
  chrome?: Partial<ChromeStyle>;
  markdown?: Partial<MarkdownStyle>;
};

/**
 * Built-in palette inspired by Catppuccin Mocha. Chat rows stay on the
 * terminal background. Notices are the exception: peach copy on a raised
 * slate band. Overrides may still set `background`
 * on any role.
 * https://github.com/catppuccin/catppuccin
 */
const mocha = {
  text: "#cdd6f4",
  subtext: "#a6adc8",
  /** Darker muted tone for secondary / reasoning copy. */
  overlay: "#7f849c",
  /** Surface behind inline / fenced code. */
  surface: "#313244",
  /** Raised slate behind a notice. Cooler than the code chip so the band reads as its own layer. */
  surface1: "#45475a",
  green: "#a6e3a1",
  /**
   * Brand mint for the MIN banner, composer rules, and user input.
   * Darker than Catppuccin Mocha green so it stays readable on light terminals.
   */
  lightGreen: "#4e9a57",
  /**
   * One step down from lightGreen. Kept for theme overrides.
   */
  darkGreen: "#3a7340",
  /**
   * Two steps down from lightGreen. Kept for theme overrides.
   */
  forestGreen: "#2d5a32",
  blue: "#89b4fa",
  yellow: "#f9e2af",
  peach: "#fab387",
  red: "#f38ba8",
  mauve: "#cba6f7",
  teal: "#94e2d5",
  sky: "#89dceb",
} as const;

/** Built-in Catppuccin-inspired accents. Only notices use a block fill. */
export const defaultTheme: TuiTheme = {
  id: "default",
  name: "Default",
  roles: {
    user: {
      label: mocha.lightGreen,
      body: mocha.lightGreen,
      dimLabel: false,
      dimBody: false,
    },
    // Assistant body inherits the terminal foreground. Thinking and tools
    // use quieter accents so those side blocks stay distinct from each other.
    assistant: {
      dimLabel: false,
      dimBody: false,
    },
    thinking: {
      label: mocha.overlay,
      body: mocha.overlay,
      dimLabel: false,
      dimBody: false,
      italicBody: true,
    },
    tool: {
      label: mocha.sky,
      body: mocha.sky,
      dimLabel: false,
      dimBody: false,
    },
    "tool-result": {
      label: mocha.subtext,
      body: mocha.subtext,
      dimLabel: false,
      dimBody: false,
    },
    "tool-error": {
      label: mocha.red,
      body: mocha.red,
      dimLabel: false,
      dimBody: false,
    },
    error: {
      label: mocha.red,
      body: mocha.red,
      dimLabel: false,
      dimBody: false,
    },
    notice: {
      label: mocha.peach,
      body: mocha.peach,
      background: mocha.surface1,
      dimLabel: false,
      dimBody: false,
    },
    sys: {
      label: mocha.subtext,
      body: mocha.subtext,
      dimLabel: true,
      dimBody: true,
    },
    gap: { dimLabel: true, dimBody: true },
    banner: {
      label: mocha.lightGreen,
      body: mocha.lightGreen,
      dimLabel: false,
      dimBody: false,
    },
    "banner-meta": {
      label: mocha.subtext,
      body: mocha.subtext,
      dimLabel: true,
      dimBody: true,
    },
  },
  frames: {
    chatBar: "▌ ",
    toolMarker: "▸ ",
    toolResult: "  │ ",
    chromeWidth: 5,
  },
  activity: {
    thinking: mocha.mauve,
    writing: mocha.teal,
    tool: mocha.sky,
    continuing: mocha.yellow,
    approval: mocha.peach,
  },
  chrome: {
    brand: mocha.lightGreen,
    error: mocha.red,
    permission: mocha.peach,
    completeSelected: mocha.lightGreen,
    statusDim: true,
  },
  markdown: {
    code: mocha.teal,
    codeBackground: mocha.surface,
    link: mocha.sky,
  },
};

const registry = new Map<string, TuiTheme>([[defaultTheme.id, defaultTheme]]);

/** Register a theme for later lookup by id. Replaces an existing id. */
export function registerTheme(theme: TuiTheme): void {
  if (!theme.id.trim()) throw new Error("theme id is required");
  registry.set(theme.id, theme);
}

export function listThemes(): string[] {
  return [...registry.keys()].sort();
}

export function getTheme(id?: string): TuiTheme {
  if (!id || id === defaultTheme.id) return registry.get(defaultTheme.id) ?? defaultTheme;
  const found = registry.get(id);
  if (!found) throw new Error(`Unknown theme: ${id}`);
  return found;
}

/**
 * Build a theme from the default (or another base) plus sparse overrides.
 * Custom themes should go through this so new role keys stay filled in.
 */
export function createTheme(overrides: ThemeOverrides, base: TuiTheme = defaultTheme): TuiTheme {
  const roles = { ...base.roles } as Record<LogKind, RoleStyle>;
  if (overrides.roles) {
    for (const key of Object.keys(overrides.roles) as LogKind[]) {
      const patch = overrides.roles[key];
      if (!patch) continue;
      roles[key] = { ...roles[key], ...patch };
    }
  }
  return {
    id: overrides.id ?? base.id,
    name: overrides.name ?? base.name,
    roles,
    frames: { ...base.frames, ...overrides.frames },
    activity: { ...base.activity, ...overrides.activity },
    chrome: { ...base.chrome, ...overrides.chrome },
    markdown: { ...base.markdown, ...overrides.markdown },
  };
}

export interface LineTone {
  label?: ThemeColor;
  body?: ThemeColor;
  background?: ThemeColor;
  dimLabel: boolean;
  dimBody: boolean;
  italicBody: boolean;
}

export function toneFor(kind: LogKind, theme: TuiTheme = defaultTheme): LineTone {
  const role = theme.roles[kind];
  return {
    label: role.label,
    body: role.body,
    background: role.background,
    dimLabel: role.dimLabel === true,
    dimBody: role.dimBody === true,
    italicBody: role.italicBody === true,
  };
}

/**
 * Resolve a TUI theme from the shared config `ui` section.
 * Unknown registered ids fall back to {@link defaultTheme}.
 */
export function themeFromConfig(ui: UiConfig = {}): TuiTheme {
  let base = defaultTheme;
  if (ui.theme) {
    try {
      base = getTheme(ui.theme);
    } catch {
      base = defaultTheme;
    }
  }
  const overrides = ui.themeOverrides;
  if (!overrides) return base;
  return createTheme(
    {
      id: overrides.id ?? `${base.id}-local`,
      name: overrides.name ?? `${base.name} (local)`,
      roles: overrides.roles as ThemeOverrides["roles"],
      frames: overrides.frames as ThemeOverrides["frames"],
      activity: overrides.activity as ThemeOverrides["activity"],
      chrome: overrides.chrome as ThemeOverrides["chrome"],
      markdown: overrides.markdown as ThemeOverrides["markdown"],
    },
    base,
  );
}
