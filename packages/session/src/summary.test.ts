import { describe, expect, it } from "vitest";
import { createMemoryStore } from "./store.js";
import { summarizeSession } from "./summary.js";

describe("summarizeSession", () => {
  it("keeps the first and latest user lines without writing them back", async () => {
    const store = createMemoryStore();
    await store.save({
      meta: {
        id: "ses_a",
        title: "stored title",
        createdAt: "2026-11-04T01:00:00.000Z",
        updatedAt: "2026-11-04T02:00:00.000Z",
      },
      messages: [
        { role: "user", content: [{ type: "text", text: "  fix the\nband  " }] },
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
        { role: "user", content: [{ type: "text", text: "show a summary" }] },
      ],
    });

    const listed = await store.list();
    expect(listed[0]).toMatchObject({
      id: "ses_a",
      turns: 2,
      messageCount: 3,
      preview: "fix the band",
      latest: "show a summary",
    });

    const loaded = await store.load("ses_a");
    expect(loaded?.meta).toEqual({
      id: "ses_a",
      title: "stored title",
      createdAt: "2026-11-04T01:00:00.000Z",
      updatedAt: "2026-11-04T02:00:00.000Z",
    });
  });

  it("falls back to the title when the transcript has no user text", () => {
    const summary = summarizeSession({
      meta: {
        id: "ses_b",
        title: "from the host",
        createdAt: "t",
        updatedAt: "t",
      },
      messages: [{ role: "assistant", content: [{ type: "text", text: "hello" }] }],
    });
    expect(summary.turns).toBe(0);
    expect(summary.preview).toBe("from the host");
    expect(summary.latest).toBeUndefined();
  });
});
