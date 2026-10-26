# `@min-agent/tui`

Ink terminal UI for min. Drives `@min-agent/client` (same experience contract as CLI / Web).

The transcript scrolls (PageUp / PageDown) and wraps instead of clipping to a short window. `--session` restores the saved history. Lines typed while the agent is running stay in the composer; Enter queues them. `/open`, `/new`, `/reset`, and `/compact` wait until the run is idle. The composer edits by grapheme (Alt+Enter or Ctrl+J for a newline). A permission prompt shows the tool or the root grant; no answer denies it after two minutes.

Visual language is intentionally aligned with Web (shadcn chat): brand **min**,
user lines in green, assistant plain, tools muted, permission prompt inline.

```bash
pnpm min-tui
pnpm min-tui -- --provider mock
```
