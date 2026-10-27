# Changelog

## Unreleased

- TUI pauses spinner/stream paints while the terminal tab is unfocused (focus reporting), slowing background-tab flicker.
- Model reasoning streams as `thinking_delta` through core/client and shows as dim `think` lines in the TUI (OpenAI Responses summary + chat `reasoning_content`).

## 0.1.0-alpha.2

TUI status and layout polish.

- Spinner status copy rotates by phase (pondering, composing, running `<tool>`, …) instead of staying on “thinking”.
- Default theme drops chat/composer block background fills; accents stay on the terminal background.
- Composer has no fill and reserves two terminal rows of height.
- Transcript growth no longer `setState`s during render, which had caused occasional screen flicker.

Install: `npm install -g @min-agent/min@alpha`

## 0.1.0-alpha.1

TUI and release polish on top of the first alpha.

- TUI default theme uses a Catppuccin Mocha-inspired palette (green/blue accents, no block background fills).
- Tool output collapses to a one-line summary by default; **Ctrl+O** expands or collapses all tool results.
- Packed `@min-agent/min` sets `repository.url` for npm provenance on public GitHub publishes.
- Architecture/contract tests lock the dependency DAG, `RunEvent` / `ClientEvent` surfaces, session projection, and permission/config sidecars.

Install: `npm install -g @min-agent/min@alpha`

## 0.1.0-alpha.0

First alpha. npm publishes one package, `@min-agent/min`, with dist-tag `alpha`. The tarball is the full monorepo build (`min`, `min-tui`, `min-web`, and the workspace dists they use). Workspace packages stay private and are not published separately.

The harness contract for this alpha:

- `@min-agent/core` is the model round-trip and the tool loop.
- Permissions, skills, workspace tools, and the projected model view are composed before `createAgent`.
- CLI, TUI, and Web all go through `@min-agent/client`.

`[a]lways` writes a remembered pattern to `<cwd>/.min/permissions.json`. `--auto` keeps those grants in memory for the process only.

Known limits: `createRuntime` does not connect MCP servers. A remembered bash approval stores the command's first token, and shell compounds are stored exactly. The TUI has the REPL commands, scrollback, grapheme editing, phase spinners, Markdown assistant text, and mermaid diagrams. Chat turns and the composer use accent foregrounds without block fills; tool output nests under each call. Slash commands complete with Tab. Shared preferences go through `@min-agent/config` (user/project JSON, env, flags); TUI themes read `ui.theme` / `ui.themeOverrides`. Assistant text is painted per burst, so the screen follows the model instead of one token per layout. `apps/tui/src/render.ts` is the content API to extract into `@min-agent/render` when Web uses it. Web and some CLI startup flags are still thinner. There is no authentication.

Publishing is a GitHub Actions workflow. Push a `v<version>` tag that matches the root `package.json` version. The workflow builds the repo and publishes `@min-agent/min` only. The repository secret is `NPM_TOKEN` and must be an Automation token (or granular with 2FA bypass); a classic Publish token hits `EOTP` under account 2FA. A version already on npm is skipped, so the same tag can be re-run. Dist-tags are `alpha`, `beta`, `rc`, `next`, or `latest`.

Packed `@min-agent/min` includes `repository.url` so npm provenance can verify the GitHub Actions source.
