# `@min-agent/config`

Layered configuration for min. Preferences, settings, credentials, providers, keybindings, MCP, and scheduled jobs each have their own file. Later layers win. A missing file is skipped. A file that is not valid JSON is skipped with a warning, and the other layers still load.

Each file is sparse: set only the fields you want to override.

## User — `~/.min/`

```text
~/.min/
├── config.json         preferences (provider, model, runtime, theme)
├── settings.json       hooks, permission policy, MCP enablement
├── auth.json           credentials · host-managed
├── providers.json      custom BYOK providers
├── keybindings.json    chord → command overrides
├── mcp.json            user-scope MCP servers
├── cron/jobs.json      scheduled jobs · managed
└── projects/{project}/
    ├── config.json     per-project state on this machine
    └── mcp.json        per-project MCP servers on this machine
```

`{project}` is a stable slug of the absolute working directory. Separators become `--`, and any other character outside letters, digits, `.`, and `_` becomes `-`. `/work/app` is `work--app`. `/work/my app` is `work--my-app`. The filesystem root is `project`.

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

Suggested gitignore. `.min/*` hides local settings, the grant ledger, and sessions. The exception puts the shared settings file back. `.mcp.json` sits next to the project, so this ignore does not hide it.

```gitignore
.min/*
!.min/settings.json
```

`<cwd>/.min/config.json` and `~/.config/min/config.json` are previous preference files. When one of them exists and is not empty, min reads it only to print a notice. The file does not change provider, model, theme, or anything else, and min does not write it. Move user preferences to `~/.min/config.json`, and per-project preferences to `~/.min/projects/{project}/config.json`.

## Layers (low → high)

1. Built-in defaults
2. `~/.min/config.json`
3. `~/.min/keybindings.json` (merged onto `ui.keybindings` from the preference files)
4. `~/.min/settings.json`, then `providers.json`, `auth.json`, `cron/jobs.json`, and `mcp.json`
5. `<cwd>/.min/settings.json` and `<cwd>/.mcp.json`
6. `~/.min/projects/{project}/config.json` and `mcp.json`
7. `<cwd>/.min/settings.local.json`
8. Environment (`MIN_*`)
9. CLI / host flags

`~/.config/min/config.json` and `<cwd>/.min/config.json` are not layers. A non-empty file produces one notice and leaves the resolved config unchanged.

Settings merge field by field. A later `permissions.bash` replaces an earlier one and leaves `permissions.read` in place. Hooks merge the same way. MCP servers merge by name: a later file replaces the whole entry for that name and leaves the other names in place.

`auth.json` and `cron/jobs.json` are attached to the resolved config. They do not change provider, theme, or permissions. An empty keybindings, providers, auth, or cron file does not count as a source. An `mcp.json` that parses, even with no servers, does.

`version` is `1`. A missing version is treated as 1. A newer integer version loads the known fields and adds a warning. Unknown preference and settings keys are kept under `extensions`.

## What the apps apply

`loadMinConfig` / `resolveMinConfig` always fill `settings`, `auth`, `providers`, `mcpServers`, and `cronJobs`. The CLI, TUI, and Web server currently use only part of that result:

| Resolved field | CLI | TUI | Web server |
|---|---|---|---|
| `provider`, `model` | yes, flags win | yes, flags win; `/model` switches them for this process | yes, `PROVIDER` / `MODEL` win |
| `reasoningEffort` | yes, the next model call | yes; `/effort` changes it for this process | yes, the next model call |
| `runtime.maxTurns`, `maxContextTokens`, `contextStrategy`, `sessionDir` | yes | yes | yes |
| `ui.theme`, `ui.themeOverrides` | — | yes, `--theme` / `MIN_THEME` win | — |
| `ui.keybindings` | — | yes, merged onto the built-in chords | — |
| `settings.permissions.bash` set to `allow` | turns bash on | turns bash on, unless `-y` / `--auto` already did | turns bash on, unless `MIN_AUTO` / `MIN_YES` |
| `settings.permissions.write` set to `ask` | confirms writes | confirms writes | confirms writes |
| `auth` | copied into the environment when the variable is unset | same | same |
| `settings.permissions.read`, `settings.hooks`, `settings.mcp` | loaded only | loaded only | loaded only |
| `providers` | loaded only | `/model <name>` selects an entry | loaded only |
| `mcpServers`, `cronJobs` | loaded only | loaded only | loaded only |

`createRuntime` does not connect MCP. A host that wants those servers calls `mcp().connect()` itself. The TUI selects a `providers.json` entry with `/model <name>`. Nothing in the apps runs `cron/jobs.json` yet.

Permission *policy* (`allow` / `ask` / `deny`) lives in settings. The remembered grant ledger stays in `<cwd>/.min/permissions.json`, and sessions stay in `<cwd>/.min/sessions/`. Those two paths are not read by this package.

## `config.json`

User preferences, and the per-project state file under `~/.min/projects/{project}/`.

```json
{
  "version": 1,
  "provider": "deepseek",
  "model": "deepseek-flash",
  "reasoningEffort": "high",
  "runtime": {
    "maxTurns": 40,
    "maxContextTokens": 256000,
    "contextStrategy": "hybrid",
    "sessionDir": ".min/sessions"
  },
  "ui": {
    "theme": "default",
    "themeOverrides": { "name": "Project" },
    "keybindings": { "ctrl+j": "newline" }
  }
}
```

Blank strings are dropped. `maxTurns` and `maxContextTokens` must be positive integers. `contextStrategy` is one of `trim`, `hmt`, `tool-offload`, `sticky-trim`, `hybrid`. `reasoningEffort` is one of `none`, `low`, `medium`, `high`, `max`; anything else is dropped with a warning. Omit it to keep the provider default (DeepSeek responses uses `high`). `ui.keybindings` here is the same sparse chord map as `keybindings.json`; the dedicated file is the one to edit.

## `settings.json`

User file, `<cwd>/.min/settings.json`, and `<cwd>/.min/settings.local.json` share this shape.

```json
{
  "version": 1,
  "permissions": { "read": "allow", "write": "ask", "bash": "ask" },
  "hooks": { "start": "pnpm lint" },
  "mcp": { "enabled": true }
}
```

`read`, `write`, and `bash` accept only `allow`, `ask`, and `deny`. Any other string is dropped. `mcp.enabled` must be a boolean. `hooks` is kept as given; no app runs those hooks yet.

## `auth.json`

Host-managed credentials. Do not put API keys in `config.json`.

```json
{
  "version": 1,
  "keys": { "DEEPSEEK_API_KEY": "sk-..." }
}
```

Only string values under `keys` are kept. `applyAuthToEnv` copies a key into the environment when that variable is unset and the name matches `[A-Za-z_][A-Za-z0-9_]*`. A value already set by the process or by `.env` stays. The CLI, TUI, and Web server load `.env` before this copy.

## `providers.json`

```json
{
  "version": 1,
  "providers": {
    "acme": {
      "kind": "openai",
      "model": "gpt",
      "baseUrl": "https://example.test/v1",
      "apiKeyEnv": "ACME_API_KEY"
    }
  }
}
```

`kind` is required. `model`, `baseUrl`, and `apiKeyEnv` are optional and trimmed. An entry without `kind` is skipped. The secret itself belongs in `auth.json` or the environment, under the name in `apiKeyEnv`. In the TUI, `/model <name>` selects one of these entries for the rest of the process. `/model <model>` switches only the model, and `/model <provider> <model>` switches both.

## `keybindings.json`

Any of these shapes works. Non-string commands are dropped.

```json
{ "version": 1, "bindings": { "enter": "newline", "shift+enter": "submit" } }
```

```json
{ "keybindings": { "enter": "newline" } }
```

```json
{ "enter": "newline" }
```

Chords are case-insensitive. `Shift+Enter`, `shift+enter`, and `return` with Shift normalize to the same chord. Modifier order in the file does not matter; the TUI rewrites them to `ctrl`, then `alt`, then `shift`, then the key.

The TUI merges this map onto its built-in table. Unknown command names are ignored. A chord set to an empty string clears that default. Commands the TUI accepts:

`submit`, `newline`, `interrupt`, `toggle-tool-output`, `toggle-thinking`, `scroll-up`, `scroll-down`, `complete`, `home`, `end`, `backspace-word`, `kill-line-start`, `left`, `right`, `up`, `down`, `backspace`, `delete`.

Built-in chords include Enter = `submit`, Shift+Enter / Alt+Enter / Ctrl+J = `newline`, Escape / Ctrl+C = `interrupt`, Ctrl+O = `toggle-tool-output`, Ctrl+T = `toggle-thinking`, PageUp / PageDown = scroll, and Tab = `complete`.

## `mcp.json` and `.mcp.json`

`mcpServers` is the usual table. `servers` is accepted as an alias.

```json
{
  "mcpServers": {
    "docs": {
      "command": "npx",
      "args": ["-y", "some-mcp"],
      "env": { "TOKEN": "t" }
    },
    "remote": { "url": "https://example.test/sse" }
  }
}
```

A `url` with no `command` is an SSE server. A `command` is stdio. `transport: "sse"` with a `url` stays SSE even if `command` is also set. `args` keeps strings only. `env` keeps string values only. An entry with neither `command` nor `url` is skipped with a warning.

## `cron/jobs.json`

```json
{
  "version": 1,
  "jobs": [
    { "id": "daily", "schedule": "0 9 * * *", "prompt": "digest", "enabled": true }
  ]
}
```

A job with a blank or missing `id` is skipped. `schedule`, `prompt`, and `enabled` are optional. This file is managed data on the resolved config. No app runs it yet.

## Environment

These variables are a layer above every file. A blank value is ignored. Counts must be positive integers.

| Variable | Field |
|---|---|
| `MIN_PROVIDER` | `provider` |
| `MIN_MODEL` | `model` |
| `MIN_REASONING_EFFORT` | `reasoningEffort` (`none`, `low`, `medium`, `high`, `max`) |
| `MIN_THEME` | `ui.theme` |
| `MIN_MAX_TURNS` | `runtime.maxTurns` |
| `MIN_MAX_CONTEXT_TOKENS` | `runtime.maxContextTokens` |
| `MIN_CONTEXT_STRATEGY` | `runtime.contextStrategy` |
| `MIN_SIMULATE_NOTICE=1` | one sample legacy-config notice for a local UI check. Settings stay unchanged. |

The Web server also treats `PROVIDER` and `MODEL` as overrides of the resolved provider and model. `MIN_WEB_PORT`, `MIN_CWD`, `MIN_YES`, `MIN_AUTO`, and `MIN_NO_TOOLS` are process switches, not config-file fields.

## Host API

```ts
import { applyAuthToEnv, resolveMinConfig } from "@min-agent/config";

const { config, warnings } = resolveMinConfig(
  { cwd },
  { provider: flags.provider, theme: flags.theme, maxTurns: flags.maxTurns },
);
applyAuthToEnv(config.auth);
```

`resolveMinConfig` loads the files and the environment, then applies flags. Pass only the flags the user actually set. An env default copied into the flags object would beat the files.

Each warning is also recorded on the process notice log (`noticeLog` in `@min-agent/core`, source `config`). CLI, TUI, and Web read it through `client.notices` and do not print the `warnings` array themselves.

`loadMinConfig` stops before flags. `applyFlagOverrides` is the same last step, and it leaves settings, auth, providers, MCP, cron, and keybindings in place.

Options on the load call:

| Option | Effect |
|---|---|
| `cwd` | Project root. Required. |
| `home` | Home directory used for `~/.min`. Defaults to the real home. |
| `env` | Environment map. Defaults to `process.env`. |
| `skipFiles` | Use defaults, env, and flags only. |
| `userPath` | Read this file instead of the whole `~/.min` tree. Project files under `cwd` still load. |
| `projectPath` | Read this file instead of `<cwd>/.min/config.json`, and skip `~/.min/projects/{project}/config.json`. |
