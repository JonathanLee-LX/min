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
  brand: ThemeColor;
  error: ThemeColor;
  permission: ThemeColor;
  completeSelected: ThemeColor;
  statusDim: boolean;
}

export interface TuiTheme {
  id: string;
  name: string;
  roles: Record<LogKind, RoleStyle>;
  frames: FrameStyle;
  activity: ActivityStyle;
  chrome: ChromeStyle;
}

export type ThemeOverrides = {
  id?: string;
  name?: string;
  roles?: Partial<Record<LogKind, Partial<RoleStyle>>>;
  frames?: Partial<FrameStyle>;
  activity?: Partial<ActivityStyle>;
  chrome?: Partial<ChromeStyle>;
};

/**
 * Built-in palette inspired by Catppuccin Mocha: accent foregrounds on the
 * terminal's own background (no chat-block fills). Overrides may still set
 * `background` when a host wants filled rows.
 * https://github.com/catppuccin/catppuccin
 */
const mocha = {
  text: "#cdd6f4",
  subtext: "#a6adc8",
  /** Darker muted tone for secondary / reasoning copy. */
  overlay: "#7f849c",
  green: "#a6e3a1",
  /** Soft mint for the MIN banner wordmark. */
  lightGreen: "#b4f0a7",
  blue: "#89b4fa",
  yellow: "#f9e2af",
  peach: "#fab387",
  red: "#f38ba8",
  mauve: "#cba6f7",
  teal: "#94e2d5",
  sky: "#89dceb",
} as const;

/** Built-in Catppuccin-inspired accents without block backgrounds. */
export const defaultTheme: TuiTheme = {
  id: "default",
  name: "Default",
  roles: {
    user: {
      label: mocha.green,
      body: mocha.green,
      dimLabel: false,
      dimBody: false,
    },
    assistant: {
      label: mocha.blue,
      body: mocha.text,
      dimLabel: false,
      dimBody: false,
    },
    thinking: {
      label: mocha.overlay,
      body: mocha.overlay,
      dimLabel: true,
      dimBody: true,
      italicBody: true,
    },
    tool: {
      label: mocha.yellow,
      body: mocha.yellow,
      dimLabel: false,
      dimBody: false,
    },
    "tool-result": {
      body: mocha.subtext,
      dimLabel: true,
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
    completeSelected: mocha.green,
    statusDim: true,
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
    },
    base,
  );
}
