# `@min-agent/config`

Layered configuration for min. One document shape, several sources, later layers win.

## Layers (low → high)

1. Built-in defaults
2. User file: `~/.config/min/config.json`
3. Project file: `<cwd>/.min/config.json`
4. Environment (`MIN_*`)
5. CLI / host flags

Missing files are fine. Each file is a **sparse** document: only set what you override.

## Compatibility rules

- `version` is required when a file is present. Unknown future versions load what they can and keep the rest in `extensions`.
- Unknown top-level keys are moved into `extensions` (not rejected), so older min can open newer files.
- `<cwd>/.min/permissions.json` and `<cwd>/.min/sessions/` stay separate. They are written often and security-sensitive; the config document holds preferences, not the grant ledger.
- `.env` / `~/.config/min/.env` still load secrets and process env. Config does not store API keys.

## Document shape (v1)

```json
{
  "version": 1,
  "provider": "deepseek",
  "model": "deepseek-flash",
  "runtime": {
    "maxTurns": 40,
    "maxContextTokens": 32000,
    "contextStrategy": "hybrid",
    "sessionDir": null
  },
  "ui": {
    "theme": "default",
    "themeOverrides": {
      "roles": {
        "user": { "background": "green", "body": "black" }
      }
    }
  },
  "extensions": {}
}
```

Hosts call `loadMinConfig({ cwd })`, then apply CLI flags with `applyFlagOverrides`.
