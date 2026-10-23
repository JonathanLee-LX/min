# @min/tui

Ink-based terminal UI for the min agent harness. Shares runtime wiring with the CLI via `@min/runtime` (skills `allowed-tools` gate + workspace tools).

## Run

```bash
pnpm --filter=@min/tui build
pnpm --filter=@min/tui start
# or globally after link:
pnpm --filter=@min/tui exec pnpm link --global
min-tui --help
```

```bash
min-tui -y
DEEPSEEK_API_KEY=... min-tui --provider deepseek
```
