# @min/cli

Minimal one-shot + REPL for the min agent harness.

## Global install (pnpm link)

From the monorepo root (after `pnpm install`):

```bash
pnpm setup            # once — puts PNPM_HOME on PATH (new shells)
pnpm link:cli         # build @min/cli and `pnpm link --global`
min --help
```

`link:cli` symlinks this workspace package; rebuild + re-run it after CLI changes.

Copy `.env.example` → `.env` at the repo root (gitignored). The CLI loads it automatically.

```bash
min -i                                # REPL: /session /reset /help /exit; Ctrl+C aborts a run
min -- "summarize README.md"          # streams assistant text (DeepSeek / OpenAI)
min --provider mock --no-tools -- "ping"
```
