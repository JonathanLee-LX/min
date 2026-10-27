# `@min-agent/tui`

Ink terminal UI for min. Drives `@min-agent/client` (same experience contract as CLI / Web).

Basic chrome uses [`@inkjs/ui`](https://github.com/vadimdemedes/ink-ui) (`Spinner`, `Badge`, `Alert`, `ProgressBar`, `ConfirmInput`, `Select`) via `src/ui/`, themed through `ThemeProvider` + `extendTheme`. The composer and transcript paint stay custom — they need multiline editing and IME caret sync that stock `TextInput` does not cover. Slash suggestions use `Select`; permission prompts use `ConfirmInput` (with host-handled `a` for remember-session).

The transcript scrolls (PageUp / PageDown) and wraps instead of clipping to a short window. `--session` restores the saved history. Lines typed while the agent is running stay in the composer; Enter queues them. `/open`, `/new`, `/reset`, and `/compact` wait until the run is idle. The composer edits by grapheme (Alt+Enter or Ctrl+J for a newline). A permission prompt shows the tool or the root grant; no answer denies it after two minutes.

User and assistant turns use a left bar and accent foregrounds with no `you` / `min` labels and no block background fills. The default theme follows Catppuccin Mocha (green user / blue assistant accents on the terminal background). The composer matches the user accent, framed by top and bottom rules (no left bar), and reserves two terminal rows of text height. Tool calls use a `▸` marker; tool output is collapsed to one summary line by default and expands with Ctrl+O. Session chrome (`sys` / `note` / `err`) stays muted. Type `/` and press Tab (or ↑↓) to complete a command. Assistant text is a small Markdown document (headings, emphasis, inline code, fenced code, lists, quotes, links). A closed `mermaid` fence is drawn as a diagram. Each transcript row is one screen line, and the lines above the window stay reachable with PageUp / PageDown. While a run is in progress the line under the transcript spins differently for thinking, writing, a tool call, a follow-up, and an approval wait, and the status words rotate (pondering, composing, running bash, …). When the model streams a reasoning summary it shows as dim `think` lines (not stored in the session). Spinner paints pause while the terminal tab is unfocused so background tabs do not flicker. The bottom status bar shows the working directory (plus git branch when available) and the active model with thinking intensity and context usage percent. A dim `/context` breakdown of system / conversation / skills / mcp / tools shares is available on demand.

Colors, frame markers, and spinner hues come from `src/theme.ts`, fed by `@min-agent/config`. Layers are defaults → `~/.config/min/config.json` → `<cwd>/.min/config.json` → `MIN_*` → `--theme`. Use `ui.theme` / `ui.themeOverrides` in those JSON files; `createTheme` / `registerTheme` remain available for code-registered palettes. Permission grants stay in `.min/permissions.json`.

TODO: extract `src/render.ts` to `@min-agent/render` when Web calls the same `renderContent`. The module is pure data and does not wrap to terminal columns.

```bash
pnpm min-tui
pnpm min-tui -- --provider mock
```
