import { createAgent, textPart, type ModelProvider } from "@min-agent/core";
import { describe, expect, it } from "vitest";
import { createSession } from "./session.js";
import { createMemoryStore } from "./store.js";
import { normalizeSessionTitle } from "./title.js";

describe("session titles", () => {
  it("defaults to the first user message and keeps a later rename", async () => {
    const agent = await createAgent({
      provider: {
        id: "title-test",
        async complete() {
          return {
            message: { role: "assistant", content: [textPart("ok")] },
            stopReason: "end",
          };
        },
      },
    });
    const store = createMemoryStore();
    const session = await createSession({ agent, store, id: "ses_title" });
    await session.run("  fix the\nband  ");
    expect(session.meta.title).toBe("fix the band");

    await session.rename("  Notice colors  ");
    expect(session.meta.title).toBe("Notice colors");
    await session.run("a later question");
    expect(session.meta.title).toBe("Notice colors");

    const listed = await store.list();
    expect(listed[0]?.title).toBe("Notice colors");
    expect(listed[0]?.preview).toBe("fix the band");
    await agent.dispose();
  });

  it("asks the model for a name without storing that request", async () => {
    const seen: string[] = [];
    const provider: ModelProvider = {
      id: "title-test",
      async complete(req) {
        const text = req.messages
          .flatMap((message) => message.content)
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        seen.push(text);
        if (req.system?.includes("Name this chat")) {
          return {
            message: { role: "assistant", content: [textPart("\"Notice colors\"\nignore")] },
            stopReason: "end",
          };
        }
        return {
          message: { role: "assistant", content: [textPart("ok")] },
          stopReason: "end",
        };
      },
    };
    const agent = await createAgent({ provider });
    const session = await createSession({ agent });
    await session.run("the notice band is hard to read");
    const before = session.messages.length;
    const title = await session.generateTitle();
    expect(title).toBe("Notice colors");
    expect(session.meta.title).toBe("Notice colors");
    expect(session.messages).toHaveLength(before);
    expect(seen.at(-1)).toContain("the notice band is hard to read");
    expect(normalizeSessionTitle("  「列表太挤」.  ")).toBe("列表太挤");
    await agent.dispose();
  });

  it("rejects an empty name and an empty transcript", async () => {
    const agent = await createAgent({
      provider: {
        id: "title-test",
        async complete() {
          return {
            message: { role: "assistant", content: [textPart("")] },
            stopReason: "end",
          };
        },
      },
    });
    const session = await createSession({ agent });
    await expect(session.rename("   ")).rejects.toThrow(/empty/);
    await expect(session.generateTitle()).rejects.toThrow(/nothing to name/);
    await agent.dispose();
  });
});