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
apps/
  cli/ tui/ webui/         Phase 2 placeholders
examples/
  basic/                   Offline mock example (+ optional live providers)
```

## Quick start

```bash
pnpm install
pnpm build
pnpm test
pnpm example          # mock provider, no API key needed
```

Live providers (optional):

```bash
PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm example
PROVIDER=openai OPENAI_API_KEY=... pnpm example
PROVIDER=deepseek DEEPSEEK_API_KEY=... pnpm example
```

DeepSeek uses OpenAI-compatible **Chat Completions** (`deepseekProvider` / `openaiChatProvider`), not the Responses API.

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
