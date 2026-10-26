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
  createAgent,
  defineTool,
  mockProvider,
  type ModelProvider,
} from "@min-agent/core";
import { createProvider } from "@min-agent/providers";
import { skills } from "@min-agent/skills";
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

function resolveExampleProvider(): ModelProvider {
  const kind = process.env.PROVIDER ?? "mock";
  if (kind === "mock") {
    return mockProvider([
      {
        text: "I'll echo that.",
        toolCalls: [{ name: "echo", arguments: { message: "hello from min" } }],
      },
      { text: "Done. The echo tool returned: hello from min" },
    ]);
  }
  return createProvider(kind);
}

const systemParts = [
  "You are min, a minimal agent harness. Prefer tools when useful.",
];
const loadedSkills = await skills({
  dirs: [skillsDir],
  appendSystem: (text) => systemParts.push(text),
});

const agent = await createAgent({
  provider: resolveExampleProvider(),
  tools: [echo, ...loadedSkills.tools],
  system: () => systemParts.join("\n\n"),
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
