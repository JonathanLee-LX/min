# Architecture contracts (0.1.0-alpha)

These invariants are locked by unit tests under `**/architecture.test.ts`, `**/contract.test.ts`, and `packages/core/src/monorepo-deps.test.ts`. Prefer extending those tests when changing behavior.

## Design goals

1. **Small core** — `@min-agent/core` is the model round-trip and tool loop only.
2. **Wide edge** — permissions, skills, MCP, and projection are composed by the host before `createAgent` / `createRuntime`.
3. **Provider-agnostic messages** — vendor SDKs stay in `@min-agent/providers` (and MCP in `@min-agent/mcp`).
4. **UI facade** — apps consume `@min-agent/client` events, not raw `RunEvent`.
5. **Layered config** — preferences via `@min-agent/config`; grants/sessions remain `.min` sidecars.

## Dependency DAG

```text
config
core
  ├─ tools
  │    └─ skills
  ├─ session
  ├─ providers
  └─ mcp
runtime ← core, providers, session, skills, tools
client  ← core, runtime, session
apps    ← client (+ config for TUI)
```

## Behavioral locks

| Area | Contract |
|------|----------|
| Core tools | `ToolRegistry.execute` returns `{ isError }` instead of throwing to the model |
| Core types | Messages use `ContentPart` (`text` / `tool_call` / `tool_result`) |
| Core events | `RunEvent` is `turn_start\|text_delta\|tool_call\|tool_result\|turn_end\|done\|error` — no `permission` |
| Core agent | `Agent` keys are `provider` / `tools` / `run` / `dispose` only |
| Session | Canonical `session.messages` stay full; assemblers only change the model view; `bindPermissionAsk` clears after run |
| Runtime | Default tool set has no MCP; permissions live on the runtime; deny → `tool_result.isError` then `done` |
| Client | `tool_end` always carries `preview` + `content`; `ClientEvent` / `MinClient` surfaces frozen; `done` is not a ClientEvent |
| Client grants | `persistPermissionGrants: false` must not write `.min/permissions.json` |
| Config | Unknown JSON keys go under `extensions`; `version` is 1; permissions/sessions stay sidecars |
| Sidecar paths | `config.permissionRulesPath` formula matches `tools.permissionRulesPath`; sessions live under `.min/sessions` |
| Tools | Sandbox rejects `..` escapes; permission rules file is `version: 1`; `grantRoot` is the escaped dir |
| Skills | `appendSystem` grows on catalog + `load_skill`; `allowed-tools` pre-approve only |
| Providers | Adapter results expose only core part types (`text` / `tool_call`) |

## Changing a contract

1. Update the failing architecture/contract test in the same PR.
2. Note the break in `CHANGELOG.md`.
3. Avoid silent renames of `ClientEvent.type` or core export names — UIs and adapters rely on them.
