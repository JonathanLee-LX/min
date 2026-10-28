import { assistantMessage, textPart, userMessage } from "@min-agent/core";
import { describe, expect, it } from "vitest";
import { buildShutdownSnapshot } from "./snapshot.js";

describe("buildShutdownSnapshot", () => {
  it("appends frozen assistant text and queued inputs", () => {
    const committed = {
      meta: {
        id: "ses_1",
        createdAt: "t0",
        updatedAt: "t0",
      },
      messages: [] as const,
    };
    const snap = buildShutdownSnapshot({
      committed: {
        ...committed,
        messages: [userMessage("hi")],
      },
      inflight: [userMessage("hi")],
      turnText: "partial answer",
      queued: ["more later"],
    });
    expect(snap.messages).toEqual([
      userMessage("hi"),
      assistantMessage([textPart("partial answer")]),
      userMessage("more later"),
    ]);
    expect(snap.messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("does not duplicate assistant text already on the last message", () => {
    const inflight = [
      userMessage("hi"),
      assistantMessage([textPart("hello")]),
    ];
    const snap = buildShutdownSnapshot({
      committed: {
        meta: { id: "s", createdAt: "t", updatedAt: "t" },
        messages: [userMessage("hi")],
      },
      inflight,
      turnText: "hello",
      queued: [],
    });
    expect(snap.messages).toEqual(inflight);
  });
});
