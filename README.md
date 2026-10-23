# min

A minimal, extensible TypeScript **agent harness**. Phase 1 ships the core runtime only — CLI / TUI / WebUI are placeholders.

## Why min

- **Small core**: one agent loop, tools, hooks, and a provider-agnostic message model.
- **Wide edge**: Extensions register tools and hooks; MCP and Agent Skills plug in without bloating the runner.
- **Dual protocols**: Anthropic Messages and OpenAI Responses adapters — vendor formats never leak into the loop.

## Monorepo

```text
packages/
  core/      @min/core     harness (Runner, tools, providers, extensions)
  mcp/       @min/mcp      MCP client extension
  skills/    @min/skills   Agent Skills (SKILL.md) extension
  tools/     @min/tools    sandboxed read/write/glob/bash
  session/   @min/session  conversation sessions + context budget
apps/
  cli/       @min/cli      minimal one-shot + REPL
  tui/ webui/              placeholders
examples/
  basic/                   Offline mock example (+ optional live providers)
```

## Quick start

```bash
pnpm install
pnpm build
pnpm test
pnpm example          # mock provider, no API key needed
pnpm min -- "list files here"   # CLI with workspace tools (mock if no key)
pnpm min -- -i                  # interactive REPL
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
- Each model call sends only a **budgeted view**: oldest user-turns are dropped when `system + tools + messages` exceed `--max-context-tokens` (default 32000, rough char/4 estimate).
- Full history remains in the session store; trimming affects the model view only (controls window limits and prompt cost growth).
- CLI: `--session <id>`, `--session-dir`, `--max-context-tokens`, `--max-user-turns`, `--list-sessions`.

Session stays a thin kernel; extend via composition:

| Extension point | Role |
|-----------------|------|
| `SessionStore` | Persist/load snapshots (`Memory` / `Fs` / custom) |
| `ContextAssembler` | Build the model view (default: budget trim) |
| `SessionHooks` | `onBeforeRun` / `onAfterAssemble` / `onAfterRun` / `onBeforeSave` |
| `SessionExtension` | Package assembler + hooks (`defineSessionExtension`) |

```ts
import { createSession, defineSessionExtension, createBudgetAssembler } from "@min/session";

const compact = defineSessionExtension({
  name: "compact-log",
  hooks: {
    onAfterRun({ assemble }) {
      if (assemble.trimmed) console.info("context trimmed", assemble.dropped.length);
    },
  },
});

const session = await createSession({
  agent,
  store,
  budget: { maxContextTokens: 16_000 },
  extensions: [compact],
  // assembler: createBudgetAssembler({ maxContextTokens: 16_000 }),
});
```

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
