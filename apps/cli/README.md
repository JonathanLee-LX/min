# @min/cli

Minimal CLI for the min agent harness.

```bash
# from repo root
pnpm min -- "list files in this workspace"
pnpm min -- -i
pnpm min -- -y "…"           # auto-approve prompts
pnpm min -- --allow-bash "…" # bash without asking
```

Uses `@min/tools` (sandboxed `read_file` / `write_file` / `glob` / `bash`) and optional `skills/` under `--cwd`.

Permissions default: read/write allow, bash ask (small allowlist auto-passes).
