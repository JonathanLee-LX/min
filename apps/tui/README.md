# `@min-agent/tui`

Ink terminal UI for min. Drives `@min-agent/client` (same experience contract as CLI / Web).

The transcript scrolls (PageUp / PageDown) and wraps instead of clipping to a short window. `--session` restores the saved history. Lines typed while the agent is running stay in the composer; Enter queues them. `/open`, `/new`, `/reset`, and `/compact` wait until the run is idle. The composer edits by grapheme (Alt+Enter or Ctrl+J for a newline). A permission prompt shows the tool or the root grant; no answer denies it after two minutes.

User and assistant turns are color blocks (green / blue) with a left bar and no `you` / `min` labels. The composer uses the same green block. Tool calls use a `▸` marker; their full output sits indented under the call. Session chrome (`sys` / `note` / `err`) stays dim. Type `/` and press Tab (or ↑↓) to complete a command. Assistant text is a small Markdown document (headings, emphasis, inline code, fenced code, lists, quotes, links). A closed `mermaid` fence is drawn as a diagram. Each transcript row is one screen line, and the lines above the window stay reachable with PageUp / PageDown. While a run is in progress the line under the transcript spins differently for thinking, writing, a tool call, a follow-up, and an approval wait.

Colors, frame markers, and spinner hues come from `src/theme.ts`. The built-in `default` theme is active today; `--theme <id>` / `MIN_THEME` select a registered theme, and `createTheme` / `registerTheme` are the hooks for custom palettes. Loading a theme file is still TODO.

TODO: extract `src/render.ts` to `@min-agent/render` when Web calls the same `renderContent`. The module is pure data and does not wrap to terminal columns.

```bash
pnpm min-tui
pnpm min-tui -- --provider mock
```
