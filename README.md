# min

A minimal, extensible TypeScript **agent harness**. Core packages, `@min/client` facade, CLI / Ink TUI / Web (shadcn B/S) — MVP slice is runnable end-to-end.

## Why min

- **Small core**: one agent loop, tools, hooks, and a provider-agnostic message model.
- **Wide edge**: Extensions register tools and hooks; MCP and Agent Skills plug in without bloating the runner.
- **Dual protocols**: Anthropic Messages and OpenAI Responses adapters — vendor formats never leak into the loop.

## Monorepo

```text
packages/
  core/      @min/core     harness (Runner, tools, providers, extensions)
  mcp/       @min/mcp      MCP client extension
  skills/    @min/skills   Agent Skills (SKILL.md) + allowed-tools gate
  tools/     @min/tools    sandboxed read/write/glob/bash
  session/   @min/session  conversation sessions + context budget + input queue
  runtime/   @min/runtime  shared composition layer for CLI / TUI
  client/    @min/client   UI facade: send / subscribe / queue / permission
apps/
  cli/       @min/cli      one-shot + REPL (via @min/client)
  tui/       @min/tui      Ink terminal UI (via @min/client)
  webui/     @min/webui    B/S Web UI — Node server + Vite/React/shadcn
examples/
  basic/                   Offline mock example (+ optional live providers)
  input-queue-scenarios/   supplement / redirect queue demos
```

## Quick start

```bash
pnpm install
pnpm build
pnpm test
pnpm example          # mock provider, no API key needed
pnpm min -- "list files here"   # CLI with workspace tools (mock if no key)
pnpm min -- -i                  # interactive REPL
pnpm min-tui                    # terminal chat UI
pnpm min-web                    # Web UI (API :43127 + Vite :43128)

# Global `min` on PATH (requires `pnpm setup` once so PNPM_HOME is exported)
pnpm link:cli
min --help
```

Live providers (optional):

```bash
PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm example
PROVIDER=openai OPENAI_API_KEY=... pnpm example
PROVIDER=deepseek DEEPSEEK_API_KEY=... pnpm example
DEEPSEEK_API_KEY=... pnpm min -- "summarize README.md"
```

DeepSeek defaults to the OpenAI-compatible **Responses** API (`deepseekProvider`). Set `DEEPSEEK_API=chat` to use Chat Completions instead.

### Workspace tools (`@min/tools`)

Registered by the CLI (unless `--no-tools`): `read_file`, `write_file`, `glob`, `bash`, all scoped to `--cwd`.

### Permissions (fluency-first)

| Surface | Default | Notes |
|---------|---------|--------|
| read / glob | allow | Inside primary + session roots |
| write_file | allow | `--ask-write` to confirm |
| bash | ask | Small allowlist (`git`, `ls`, `pnpm`, …) auto-passes |
| path outside roots | ask | Approving adds a **tight session root** (`dirname` / dir itself) |

- Interactive ask: `[y]es / [n]o / [a]lways…`
- `-y` auto-approves tool prompts but **not** root expansion (needs `--allow-root-grant` or interactive)
- Seed roots: `--add-root <dir>` (repeatable)
- One-shot without TTY: `ask` → deny unless flags allow
- Denied tools return `tool_result` with `isError` — the run continues
- Core only enforces `allow \| deny \| ask` (+ optional `grantRoot`); policy lives in `@min/tools` / CLI

### Sessions and context budget (`@min/session`)

- Canonical history is kept in a `Session` (optionally under `<cwd>/.min/sessions`).
- Model view is built by a **pluggable `ContextAssembler`** (SessionExtension). Strategies are swappable for eval:

| Strategy | How to enable | Behavior |
|----------|---------------|----------|
| **`hybrid`** (default w/ tools) | default when tools on | Sticky head + middle tool-offload + **intra-turn aging** (fold older `tool_result`s inside the active turn, keep last N verbatim) + middle collapse; + `recall_context`. |
| **`trim`** (default w/o tools) | `--no-tools` / `contextStrategy: "trim"` | Drop oldest user-turns under budget. Eval baseline. |
| **`sticky-trim`** | `contextStrategy: "sticky-trim"` | Freeze leading turns; only trim after them (cache-friendlier). |
| **`tool-offload`** | `contextStrategy: "tool-offload"` | Fold large `tool_result`s into stash (protect last turn); + `recall_context`. |
| **`hmt`** | `contextStrategy: "hmt"` | Head/middle/tail: fold middle only; + stash/`recall_context`. |

On-demand (not a continuous strategy): `session.compact()` / Client `compact()` / REPL `/compact` rewrites stored history to `[LLM summary] + recent turns`.

**Dual history + mid-loop projection**

- Canonical session / Runner history stays full (including fat tool bodies).
- Before every model `complete` inside a tool loop, Session re-runs the assembler via `RunInput.projectMessages` and sends only the projected view.
- That closes the gap where a single user-turn coding run never got a second assemble (hybrid used to look idle until the next `session.run`).
- Multi-turn fold/stash/recall check: `pnpm --filter @min/example-hmt-context exec tsx verify-multiturn.mts`

- Stash markers look like `…[hidden:tool_<id> · recall_context]…` when a stash strategy is on.
- Token estimate defaults to ~4 chars/token; inject `budget.estimate` to override.
- CLI: `--context-strategy <id>`, `--session`, `--max-context-tokens`, …
- Env: `MIN_CONTEXT_STRATEGY=trim|hmt|tool-offload|sticky-trim|hybrid`.
- CLI `context-budget-log` prints after every assemble (including mid-loop), not only when trimmed.

Session stays a thin kernel; extend via composition:

| Extension point | Role |
|-----------------|------|
| `SessionStore` | Persist/load snapshots (`Memory` / `Fs` / custom) |
| `ContextAssembler` | Build the model view (default: hybrid w/ tools, trim otherwise) |
| `SessionHooks` | `onBeforeRun` / `onAfterAssemble` / `onAfterRun` / `onBeforeSave` |
| `SessionExtension` | Package assembler + hooks (`defineSessionExtension`) |

Kernel responsibilities only: identity, canonical history, `run`/`compact`/`reset`/`export`, store I/O.
Follow-up **input queue** (`createInputQueue`) lives in `@min/session` only: default `enqueue`, with a 1.5s `dense-latest` window for rapid supplements. Drained **after** each `agent.run` returns — `@min/core` is unchanged.
Everything else plugs in:

```ts
import { createSession, defineSessionExtension, createBudgetAssembler } from "@min/session";

const compact = defineSessionExtension({
  name: "compact-log",
  // Optional: replace the default budget assembler
  // assembler: createBudgetAssembler({ maxContextTokens: 16_000 }),
  hooks: {
    onBeforeRun() { /* audit / metrics */ },
    onAfterAssemble(ctx) {
      // Return a new AssembleResult to override the model view
      return ctx.assemble;
    },
    onAfterRun({ assemble }) {
      if (assemble.trimmed) console.info("context trimmed", assemble.dropped.length);
    },
    onBeforeSave(snapshot) {
      // Transform or redact before persist
      return snapshot;
    },
  },
});

const session = await createSession({
  agent,
  store,
  budget: { maxContextTokens: 16_000 },
  extensions: [compact],
  // assembler: …  // explicit option wins over extension assemblers
});
```

The CLI ships one pack (`cli.context-budget-log`) the same way — observability stays outside the kernel.

## Usage

```ts
import { createAgent, defineTool, anthropicProvider } from "@min/core";
import { mcp } from "@min/mcp";
import { skills } from "@min/skills";
import { z } from "zod";

const agent = await createAgent({
  provider: anthropicProvider({ model: "claude-sonnet-4-5" }),
  // or: openaiProvider({ model: "gpt-4.1" })
  tools: [
    defineTool({
      name: "echo",
      description: "Echo a string",
      inputSchema: z.object({ message: z.string() }),
      async execute({ message }) {
        return { content: message };
      },
    }),
  ],
  extensions: [
    skills({ dirs: ["./skills"] }),
    mcp({
      servers: [{ name: "fs", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] }],
    }),
  ],
  system: "You are min.",
});

const result = await agent.run("Hello");
console.log(result.text);
await agent.dispose();
```

### Writing an extension

```ts
import { defineExtension, defineTool } from "@min/core";
import { z } from "zod";

export const myExt = defineExtension({
  name: "my-ext",
  setup(api) {
    api.appendSystem("Extra instructions.");
    api.registerTool(
      defineTool({
        name: "ping",
        description: "Ping",
        inputSchema: z.object({}),
        async execute() {
          return { content: "pong" };
        },
      }),
    );
    api.addHook({
      onBeforeTool({ toolCall }) {
        console.log("calling", toolCall.name);
      },
    });
  },
});
```

### Skills layout

```text
skills/
  greeter/
    SKILL.md    # YAML frontmatter: name + description
```

Follows the [Agent Skills](https://agentskills.io/specification) format. Metadata loads at startup; full body loads via the `load_skill` tool (progressive disclosure).

## Design notes

| Layer | Responsibility |
|-------|----------------|
| Internal messages | Single source of truth (`text` / `tool_call` / `tool_result`) |
| `ModelProvider` | Translate to Anthropic Messages or OpenAI Responses |
| `Runner` | Thin tool-use loop + hooks |
| `Extension` | Register tools, hooks, system appends |

Phase 2 will add interactive surfaces under `apps/` without changing the harness contract.
