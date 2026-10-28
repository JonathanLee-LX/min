# @min-agent/cli

`min` entry for the agent harness: **TUI by default**, one-shot / REPL via flags.

## Commands

```bash
min                         # open the terminal UI (default)
min -p "your prompt"        # one-shot
min --prompt "your prompt"  # same as -p
min -i                      # interactive REPL
min --list-sessions         # list saved sessions
min-tui                     # TUI explicitly
```

## Global install (pnpm link)

From the monorepo root (after `pnpm install`):

```bash
pnpm setup            # once — puts PNPM_HOME on PATH (new shells)
pnpm link:cli         # build CLI + TUI and link both globally
min -h
```

`link:cli` builds and links `@min-agent/cli` (`min`) and `@min-agent/tui` (`min-tui`).

Copy `.env.example` → `.env` at the repo root (gitignored). The CLI loads it automatically.

```bash
min -i                                # REPL: /session /compact /reset /help /exit
min -p "summarize README.md"          # streams assistant text
min --provider mock --no-tools -p "ping"
```
