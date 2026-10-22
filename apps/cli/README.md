# @min/cli

Minimal CLI for the min agent harness.

```bash
# from repo root
pnpm --filter=@min/cli start -- "list files in this workspace"
pnpm --filter=@min/cli start -- -i
```

Uses `@min/tools` (sandboxed `read_file` / `write_file` / `glob` / `bash`) and optional `skills/` under `--cwd`.
