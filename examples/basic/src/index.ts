/**
 * Programmatic smoke example — no UI.
 * Uses a mock provider by default so it runs offline.
 *
 * With a real key:
 *   PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm example
 *   PROVIDER=openai OPENAI_API_KEY=... pnpm example
 *   PROVIDER=deepseek DEEPSEEK_API_KEY=... pnpm example
 */
import {
  anthropicProvider,
  createAgent,
  deepseekProvider,
  defineTool,
  mockProvider,
  openaiProvider,
  type ModelProvider,
} from "@min/core";
import { skills } from "@min/skills";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(__dirname, "../skills");

const echo = defineTool({
  name: "echo",
  description: "Echo back a message",
  inputSchema: z.object({
    message: z.string(),
  }),
  async execute({ message }) {
    return { content: message };
  },
});

function resolveProvider(): ModelProvider {
  const kind = process.env.PROVIDER ?? "mock";
  if (kind === "anthropic") {
    return anthropicProvider({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    });
  }
  if (kind === "openai") {
    return openaiProvider({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1",
    });
  }
  if (kind === "deepseek") {
    // Default: Responses API. Set DEEPSEEK_API=chat for Chat Completions.
    const api =
      process.env.DEEPSEEK_API === "chat"
        ? ("chat" as const)
        : ("responses" as const);
    return deepseekProvider({
      api,
      model:
        process.env.DEEPSEEK_MODEL ??
        (api === "chat" ? "deepseek-chat" : "deepseek-flash"),
    });
  }

  return mockProvider([
    {
      text: "I'll echo that.",
      toolCalls: [{ name: "echo", arguments: { message: "hello from min" } }],
    },
    { text: "Done. The echo tool returned: hello from min" },
  ]);
}

const agent = await createAgent({
  provider: resolveProvider(),
  tools: [echo],
  extensions: [skills({ dirs: [skillsDir] })],
  system: "You are min, a minimal agent harness. Prefer tools when useful.",
  maxTurns: 8,
});

const result = await agent.run({
  input: "Say hello using the echo tool.",
  onEvent(event) {
    if (event.type === "text_delta") process.stdout.write(event.text);
    if (event.type === "tool_call") {
      console.log(`\n→ tool ${event.toolCall.name}(${JSON.stringify(event.toolCall.arguments)})`);
    }
    if (event.type === "tool_result") {
      console.log(`← ${event.content}`);
    }
  },
});

console.log("\n---");
console.log(`turns=${result.turns}`);
console.log(`final: ${result.text}`);

await agent.dispose();
