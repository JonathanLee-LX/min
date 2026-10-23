# @min/cli

Minimal CLI for the min agent harness.

```bash
# from repo root
pnpm min -- "list files in this workspace"
pnpm min -- -i
pnpm min -- -y "…"                      # auto-approve tool prompts (not root grants)
pnpm min -- --allow-bash "…"            # bash without asking
pnpm min -- --add-root /other -- "…"    # seed an extra session root
pnpm min -- -y --allow-root-grant "…"   # also auto-approve session root grants
```

Uses `@min/tools` (sandboxed `read_file` / `write_file` / `glob` / `bash`) and optional `skills/` under `--cwd`.

Permissions default: read/write allow inside roots, bash ask (small allowlist). Outside-root paths ask to add a tight session root.
