# `@min-agent/tui`

Ink terminal UI for min. Drives `@min-agent/client` (same experience contract as CLI / Web).

The transcript scrolls (PageUp / PageDown) and wraps instead of clipping to a short window. `--session` restores the saved history. Lines typed while the agent is running stay in the composer; Enter queues them. `/open`, `/new`, `/reset`, and `/compact` wait until the run is idle. The composer edits by grapheme (Alt+Enter or Ctrl+J for a newline). A permission prompt shows the tool or the root grant; no answer denies it after two minutes.

Transcript rows keep a speaker column: `you` and `min` are the turns, `tool` / `ok` / `fail` are calls and results, `err` / `note` / `sys` are chrome. Answers stay bright; tool output and session notes step back. Assistant text is a small Markdown document (headings, emphasis, inline code, fenced code, lists, quotes, links). While a run is in progress the line under the transcript spins differently for thinking, writing, a tool call, a follow-up, and an approval wait.

TODO: extract `src/render.ts` to `@min-agent/render` when Web calls the same `renderContent`. The module is pure data and does not wrap to terminal columns.

```bash
pnpm min-tui
pnpm min-tui -- --provider mock
```
