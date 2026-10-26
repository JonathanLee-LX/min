import { createAgent, defineTool, mockProvider } from "@min-agent/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSessionExtension } from "./extension.js";
import { createMemoryStore, createSession, hybridContextExtension } from "./index.js";

describe("session architecture contracts", () => {
  it("keeps canonical history intact while projection only changes the model view", async () => {
    const provider = mockProvider([{ text: "answer" }]);
    const agent = await createAgent({ provider });
    const session = await createSession({
      agent,
      store: createMemoryStore(),
      extensions: [
        defineSessionExtension({
          name: "redact-test",
          assembler: {
            assemble(input) {
              const view = input.messages.map((message) =>
                message.role === "user"
                  ? {
                      role: "user" as const,
                      content: [{ type: "text" as const, text: "REDACTED" }],
                    }
                  : message,
              );
              return {
                view,
                dropped: [],
                estimatedTokens: 1,
                messageBudget: 1,
                trimmed: false,
              };
            },
          },
        }),
      ],
    });
    await session.run("secret prompt");

    const modelView = provider.calls[0]?.messages ?? [];
    expect(modelView.find((message) => message.role === "user")).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "REDACTED" }],
    });
    expect(session.messages.find((message) => message.role === "user")).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "secret prompt" }],
    });
    await session.dispose();
    await agent.dispose();
  });

  it("folds tool bodies in the model view while store history stays full", async () => {
    const blob = "Z".repeat(8_000);
    const provider = mockProvider([
      { toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "a" } }] },
      { toolCalls: [{ id: "c2", name: "read_file", arguments: { path: "b" } }] },
      { toolCalls: [{ id: "c3", name: "read_file", arguments: { path: "c" } }] },
      { text: "done" },
    ]);
    const agent = await createAgent({
      provider,
      tools: [
        defineTool({
          name: "read_file",
          description: "read",
          inputSchema: z.object({ path: z.string() }),
          async execute() {
            return { content: blob };
          },
        }),
      ],
    });
    const hybrid = hybridContextExtension({
      budget: {
        maxContextTokens: 100_000,
        fold: {
          maxToolResultChars: 500,
          toolResultHeadChars: 60,
          toolResultTailChars: 60,
        },
      },
      protectRecentToolResults: 1,
    });
    const session = await createSession({
      agent,
      store: createMemoryStore(),
      stash: hybrid.stash,
      extensions: [hybrid],
    });

    await session.run("fold me");
    expect(session.lastAssemble?.foldedParts ?? 0).toBeGreaterThan(0);
    const viewTool = session.lastAssemble?.view.find((message) => message.role === "tool");
    expect(viewTool?.content[0]?.type).toBe("tool_result");
    if (viewTool?.content[0]?.type === "tool_result") {
      expect(viewTool.content[0].content.length).toBeLessThan(blob.length);
      expect(viewTool.content[0].content).toMatch(/hidden:|truncated|recall_context/);
    }

    const stored = session.messages.filter((item) => item.role === "tool");
    expect(stored).toHaveLength(3);
    for (const message of stored) {
      const part = message.content[0];
      expect(part?.type).toBe("tool_result");
      if (part?.type === "tool_result") expect(part.content).toBe(blob);
    }

    await session.dispose();
    await agent.dispose();
  });

  it("clears bindPermissionAsk after each run", async () => {
    const binds: Array<unknown> = [];
    const agent = await createAgent({
      provider: mockProvider([{ text: "ok" }]),
    });
    const session = await createSession({
      agent,
      store: createMemoryStore(),
      bindPermissionAsk(ask) {
        binds.push(ask);
      },
    });

    await session.run("one", {
      async onPermissionAsk() {
        return "deny";
      },
    });
    expect(binds.length).toBeGreaterThanOrEqual(2);
    expect(binds.at(-1)).toBeUndefined();

    await session.run("two");
    expect(binds.at(-1)).toBeUndefined();
    await session.dispose();
    await agent.dispose();
  });
});
