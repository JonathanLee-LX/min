# Changelog

## 0.1.0-alpha.0

First alpha. npm publishes one package, `@min-agent/min`, with dist-tag `alpha`. The tarball is the full monorepo build (`min`, `min-tui`, `min-web`, and the workspace dists they use). Workspace packages stay private and are not published separately.

The harness contract for this alpha:

- `@min-agent/core` is the model round-trip and the tool loop.
- Permissions, skills, workspace tools, and the projected model view are composed before `createAgent`.
- CLI, TUI, and Web all go through `@min-agent/client`.

`[a]lways` writes a remembered pattern to `<cwd>/.min/permissions.json`. `--auto` keeps those grants in memory for the process only.

Known limits: `createRuntime` does not connect MCP servers. A remembered bash approval stores the command's first token, and shell compounds are stored exactly. The TUI has the REPL commands, scrollback, grapheme editing, phase spinners, Markdown assistant text, and mermaid diagrams. Chat turns and the composer are color blocks without you/min labels; tool output nests under each call. Slash commands complete with Tab. Colors go through `src/theme.ts` (`createTheme` / `registerTheme` / `--theme`) so custom themes can plug in later. Assistant text is painted per burst, so the screen follows the model instead of one token per layout. `apps/tui/src/render.ts` is the content API to extract into `@min-agent/render` when Web uses it. Web and some CLI startup flags are still thinner. There is no authentication.

Publishing is a GitHub Actions workflow. Push a `v<version>` tag that matches the root `package.json` version. The workflow builds the repo and publishes `@min-agent/min` only. The repository secret is `NPM_TOKEN`. A version already on npm is skipped, so the same tag can be re-run. Dist-tags are `alpha`, `beta`, `rc`, `next`, or `latest`.

Package metadata has no `repository` URL yet.
