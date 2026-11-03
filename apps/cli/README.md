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

Copy `.env.example` → `.env` at the repo root (gitignored). The CLI loads it before config, so a value in `.env` beats the same key in `~/.min/auth.json`.

```bash
min -i                                # REPL: /session /compact /reset /help /exit
min -p "summarize README.md"          # streams assistant text
min --provider mock --no-tools -p "ping"
```

## Config

`min` and `min -p` / `min -i` read the same files as the TUI. Details and examples are in [`packages/config/README.md`](../../packages/config/README.md).

From those files the CLI applies `provider`, `model`, `runtime.maxTurns`, `runtime.maxContextTokens`, `runtime.contextStrategy`, and `runtime.sessionDir`. `settings.permissions.bash` set to `allow` turns bash on. `settings.permissions.write` set to `ask` confirms writes. An explicit flag (`--provider`, `--model`, `--max-turns`, `--max-context-tokens`, `--context-strategy`, `--session-dir`) beats the file and `MIN_*`. `--allow-bash` and `--ask-write` still force those modes when the settings file says something else.

`providers.json`, MCP servers, and `cron/jobs.json` are loaded and not used by the CLI yet.
