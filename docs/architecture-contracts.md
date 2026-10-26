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
| Session | Canonical `session.messages` stay full; assemblers only change the model view |
| Runtime | Default tool set has no MCP; permissions live on the runtime, not the agent |
| Client | `tool_end` always carries `preview` + `content`; event discriminants are frozen |
| Config | Unknown JSON keys go under `extensions`; `version` is 1 |
| Tools | Sandbox rejects `..` escapes; permission rules file is `version: 1` |

## Changing a contract

1. Update the failing architecture/contract test in the same PR.
2. Note the break in `CHANGELOG.md`.
3. Avoid silent renames of `ClientEvent.type` or core export names — UIs and adapters rely on them.
