import {
  defaultTheme as inkDefaultTheme,
  extendTheme,
  type Theme as InkTheme,
} from "@inkjs/ui";
import type { TextProps } from "ink";
import type { TuiTheme } from "../theme.js";

/**
 * Bridge min's Catppuccin-inspired {@link TuiTheme} into `@inkjs/ui`.
 * Basic chrome (spinner / badge / alert / progress) reads these tokens.
 */
export function inkThemeFromTui(theme: TuiTheme, spinnerColor?: string): InkTheme {
  const frameColor = (spinnerColor ?? theme.activity.thinking) as TextProps["color"];
  return extendTheme(inkDefaultTheme, {
    components: {
      Spinner: {
        styles: {
          frame: (): TextProps => ({ color: frameColor }),
          label: (): TextProps => ({ color: frameColor }),
        },
      },
      Badge: {
        styles: {
          container: ({ color }: { color?: TextProps["backgroundColor"] }): TextProps => ({
            backgroundColor: color ?? (theme.chrome.brand as TextProps["backgroundColor"]),
          }),
          label: (): TextProps => ({ color: "black" }),
        },
      },
      ProgressBar: {
        styles: {
          completed: (): TextProps => ({
            color: theme.chrome.brand as TextProps["color"],
          }),
          remaining: (): TextProps => ({ dimColor: true }),
        },
      },
    },
  });
}
