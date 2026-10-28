import { mockProvider } from "@min-agent/core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createClient } from "./client.js";
import { createEventTranslator } from "./events.js";
import * as clientApi from "./index.js";
import type { ClientEvent } from "./types.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PUBLIC_EXPORTS = [
  "createAutoPermissionApprover",
  "createClient",
  "createEventTranslator",
  "createPermissionBridge",
  "formatContextUsageBreakdown",
  "formatContextUsageReport",
  "formatContextUsageShort",
  "formatTokenCount",
  "isAbortError",
  "previewArgs",
].sort();

const CLIENT_EVENT_TYPES = [
  "assistant_delta",
  "assistant_done",
  "context",
  "error",
  "follow_up",
  "permission",
  "queued",
  "session",
  "status",
  "thinking_delta",
  "thinking_done",
  "tool_end",
  "tool_start",
].sort();

describe("client architecture contracts", () => {
  it("exposes a stable public API surface", () => {
    expect(Object.keys(clientApi).sort()).toEqual(PUBLIC_EXPORTS);
  });

  it("depends on core/runtime/session, not tools or providers directly", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual([
      "@min-agent/core",
      "@min-agent/runtime",
      "@min-agent/session",
    ]);
  });

  it("freezes the ClientEvent discriminant set used by UIs", () => {
    const source = readFileSync(path.join(ROOT, "src", "types.ts"), "utf8");
    const types = [...source.matchAll(/type:\s*"([a-z_]+)"/g)].map((match) => match[1]!);
    const unique = [...new Set(types)].sort();
    expect(unique).toEqual(CLIENT_EVENT_TYPES);
  });

  it("translates tool_result into tool_end with both preview and full content", () => {
    const translator = createEventTranslator();
    translator.push({
      type: "tool_call",
      toolCall: {
        type: "tool_call",
        id: "t1",
        name: "bash",
        arguments: { command: "echo" },
      },
    });
    const body = `line1\n${"x".repeat(300)}`;
    const [event] = translator.push({
      type: "tool_result",
      toolCallId: "t1",
      content: body,
      isError: false,
    });
    expect(event).toMatchObject({
      type: "tool_end",
      toolCallId: "t1",
      ok: true,
      content: body,
    });
    if (event?.type !== "tool_end") throw new Error("expected tool_end");
    expect(event.preview.includes("\n")).toBe(false);
    expect(event.preview.length).toBeLessThanOrEqual(200);
  });

  it("keeps UIs on ClientEvent — RunEvent types are not re-exported", () => {
    expect("Runner" in clientApi).toBe(false);
    expect("RunEvent" in clientApi).toBe(false);
  });

  it("freezes MinClient method surface for UI hosts", async () => {
    const client = await createClient({
      cwd: process.cwd(),
      provider: mockProvider([{ text: "ready" }]),
      noTools: true,
      noSessionStore: true,
    });
    expect(Object.keys(client).sort()).toEqual(
      [
        "abort",
        "advanced",
        "compact",
        "dispose",
        "getSession",
        "getStatus",
        "listSessions",
        "newSession",
        "openSession",
        "queue",
        "reset",
        "respondPermission",
        "send",
        "subscribe",
      ].sort(),
    );
    await client.dispose();
  });

  it("drops core done events — they are not ClientEvents", () => {
    const translator = createEventTranslator();
    expect(
      translator.push({
        type: "done",
        messages: [],
      }),
    ).toEqual([]);
    expect(
      translator.push({
        type: "turn_start",
        turn: 1,
      }),
    ).toEqual([]);
  });

  it("reports idle with a status snapshot after a simple turn", async () => {
    const events: ClientEvent[] = [];
    const client = await createClient({
      cwd: process.cwd(),
      provider: mockProvider([{ text: "ready" }]),
      noTools: true,
      noSessionStore: true,
    });
    client.subscribe((event) => events.push(event));
    await client.send("ping");
    expect(client.getStatus()).toMatchObject({
      status: "idle",
      busy: false,
    });
    expect(client.getSession().messages.some((message) => message.role === "user")).toBe(true);
    expect(events.some((event) => event.type === "assistant_done")).toBe(true);
    await client.dispose();
  });
});
