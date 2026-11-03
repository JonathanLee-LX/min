# `@min-agent/webui`

Browser UI for min (B/S). Uses **shadcn/ui**-style React primitives + Tailwind.
Assistant messages are painted from `@min-agent/render` (`MarkdownView`).

## Architecture (MVP)

```text
Browser (Vite/React/shadcn)
    │  HTTP send/queue/permission + SSE /events
    ▼
Node server process  ← holds @min-agent/client (MinClient)
    ▼
@min-agent/runtime → session / core / tools
```

**Isolation (current):** the browser never loads MinClient or API keys. The HTTP
server and Client share one Node process (simplest).

**Later (optional):** move MinClient into a worker/child process behind the same
HTTP contract if you need crash isolation or multi-tenant workers.

## Dev

```bash
# terminal A+B via concurrently
pnpm --filter=@min-agent/webui dev
# API  http://127.0.0.1:43127
# Vite http://127.0.0.1:43128  (proxies /api and /events)
```

The server reads the same `@min-agent/config` files as the CLI, with `cwd` from `MIN_CWD` (otherwise the process working directory). It applies provider, model, runtime limits, `settings.permissions.bash: "allow"`, and `settings.permissions.write: "ask"`. `PROVIDER` and `MODEL` override the config file. `auth.json` fills an API key only when that variable is still unset. Schemas are in [`packages/config/README.md`](../../packages/config/README.md).

Env: same as CLI (`DEEPSEEK_API_KEY`, `PROVIDER`, …). Optional:

| var | meaning |
|-----|---------|
| `MIN_WEB_PORT` | API port (default `43127`) |
| `MIN_CWD` | sandbox / session cwd |
| `MIN_YES=1` | auto-approve permissions |
| `MIN_NO_TOOLS=1` | disable workspace tools |

## Production

```bash
pnpm --filter=@min-agent/webui build
pnpm --filter=@min-agent/webui start   # serves API + dist/web on MIN_WEB_PORT
```

## UI notes

Chat layout mirrors TUI: brand **min**, user bubbles (primary), assistant
(secondary), muted tool lines, permission bar. Intentionally minimal — iterate later.
