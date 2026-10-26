import { createAgent, mockProvider } from "@min-agent/core";
import { describe, expect, it } from "vitest";
import { defineSessionExtension } from "./extension.js";
import { createMemoryStore, createSession } from "./index.js";

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

  it("starts with empty canonical history and a runnable session", async () => {
    const agent = await createAgent({
      provider: mockProvider([{ text: "ok" }]),
    });
    const session = await createSession({
      agent,
      store: createMemoryStore(),
      budget: { maxContextTokens: 8_000 },
    });
    expect(session.messages).toEqual([]);
    expect(typeof session.run).toBe("function");
    await session.dispose();
    await agent.dispose();
  });
});
