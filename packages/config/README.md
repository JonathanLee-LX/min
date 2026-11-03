# `@min-agent/config`

Layered configuration for min. Preferences, settings, credentials, providers, keybindings, and MCP each have their own file. Later layers win.

## User — `~/.min/`

```text
~/.min/
├── config.json         preferences (provider, model, runtime, theme)
├── settings.json       hooks, permission policy, MCP enablement
├── auth.json           credentials · host-managed, not a preferences file
├── providers.json      custom BYOK providers (kind, model, base URL, apiKeyEnv)
├── keybindings.json    chord → command overrides
├── mcp.json            user-scope MCP servers
├── cron/jobs.json      scheduled jobs · managed
└── projects/{project}/
    ├── config.json     per-project state on this machine
    └── mcp.json        per-project MCP servers on this machine
```

`{project}` is the absolute cwd with separators turned into `--` (`/work/app` → `work--app`).

## Project — `<cwd>/`

```text
<cwd>/
├── .min/
│   ├── settings.json        shared hooks and permission policy · commit
│   ├── settings.local.json  this machine only · gitignore
│   ├── permissions.json     remembered grants · managed, gitignore
│   └── sessions/            conversation store · managed, gitignore
└── .mcp.json                shared MCP servers · commit
```

Suggested gitignore:

```gitignore
.min/*
!.min/settings.json
```

## Layers (low → high)

1. Built-in defaults
2. Legacy user file `~/.config/min/config.json`, then `~/.min/config.json`
3. `~/.min/keybindings.json`
4. `~/.min/settings.json`, `providers.json`, `mcp.json`
5. Legacy project file `<cwd>/.min/config.json`
6. `<cwd>/.min/settings.json` and `<cwd>/.mcp.json`
7. `~/.min/projects/{project}/config.json` and `mcp.json`
8. `<cwd>/.min/settings.local.json`
9. Environment (`MIN_*`)
10. CLI / host flags

`auth.json` and `cron/jobs.json` are attached to the resolved config. They do not override preferences. `applyAuthToEnv` copies auth keys into the environment only when that variable is unset.

Missing files are fine. Each file is sparse: only set what you override.

## Compatibility

- `version` is `1`. Unknown future versions load known fields.
- Unknown preference keys land in `extensions`.
- `<cwd>/.min/permissions.json` and `<cwd>/.min/sessions/` stay separate. They are written often. Settings hold the permission policy (`allow` / `ask` / `deny`), not the grant ledger.
- API keys belong in `auth.json` or `.env`, not in `config.json`.

## Preference document

```json
{
  "version": 1,
  "provider": "deepseek",
  "model": "deepseek-flash",
  "runtime": {
    "maxTurns": 40,
    "maxContextTokens": 256000,
    "contextStrategy": "hybrid"
  },
  "ui": {
    "theme": "default",
    "themeOverrides": {}
  }
}
```

Keybindings live in `~/.min/keybindings.json`:

```json
{ "version": 1, "bindings": { "enter": "submit", "shift+enter": "newline" } }
```

MCP files use `mcpServers`:

```json
{ "mcpServers": { "docs": { "command": "npx", "args": ["-y", "some-mcp"] } } }
```

Hosts call `loadMinConfig({ cwd })`, then `applyFlagOverrides` or `resolveMinConfig`.
