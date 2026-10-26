# Changelog

## 0.1.0-alpha.0

First alpha under the npm scope `@min-agent`. Publish with dist-tag `alpha`.

Published packages: `cli`, `tui`, `webui`, `client`, `runtime`, `core`, `providers`, `tools`, `skills`, `session`, `mcp`. Examples and demos stay private.

The harness contract for this alpha:

- `@min-agent/core` is the model round-trip and the tool loop.
- Permissions, skills, workspace tools, and the projected model view are composed before `createAgent`.
- CLI, TUI, and Web all go through `@min-agent/client`.

`[a]lways` writes a remembered pattern to `<cwd>/.min/permissions.json`. `--auto` keeps those grants in memory for the process only.

Known limits: `createRuntime` does not connect MCP servers. A remembered bash approval stores the command's first token, and shell compounds are stored exactly. Web and TUI are thinner than the CLI. There is no authentication.

Publishing is a GitHub Actions workflow. Push a `v<version>` tag after every public package under `packages/` and `apps/` is set to that version. The repository secret is `NPM_TOKEN`. A version already on npm is skipped, so the same tag can be re-run. Dist-tags are `alpha`, `beta`, `rc`, `next`, or `latest`.

Package metadata has no `repository` URL yet.
