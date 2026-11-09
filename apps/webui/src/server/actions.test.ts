import type { MinClient } from "@min-agent/client";
import type { ModelControls } from "@min-agent/runtime";
import { describe, expect, it } from "vitest";
import { executeCommand, selectModel, type CommandHost } from "./actions.js";

function host(overrides?: {
  busy?: boolean;
  effort?: "low" | "high";
}): { host: CommandHost; controls: ModelControls } {
  const state: { kind: string; model: string; effort?: "low" | "high" } = {
    kind: "mock",
    model: "mock",
    ...(overrides?.effort ? { effort: overrides.effort } : {}),
  };
  const controls: ModelControls = {
    selection: () => ({
      kind: state.kind,
      model: state.model,
      ...(state.effort ? { effort: state.effort } : {}),
    }),
    models: () => ["mock", "mock-large"],
    setModel(model) {
      state.model = model;
    },
    setProvider(next) {
      state.kind = next.kind;
      if (next.model) state.model = next.model;
    },
    setEffort(effort) {
      state.effort = effort === "low" || effort === "high" ? effort : undefined;
    },
  };
  const client = {
    getStatus: () => ({
      status: overrides?.busy ? "running" : "idle",
      busy: Boolean(overrides?.busy),
      provider: "mock:mock",
      sessionId: "sess",
      queueSize: 1,
      cwd: "/tmp",
    }),
    getSession: () => ({ id: "sess", title: "Demo", messageCount: 2, messages: [] }),
    queue: {
      push() {
        return undefined;
      },
      peek: () => ["follow up"],
      clear() {
        return undefined;
      },
      size: 1,
    },
    listSessions: async () => [],
    openSession: async () => undefined,
    newSession: async () => undefined,
    reset: () => undefined,
    renameSession: async () => undefined,
    generateSessionTitle: async () => "Generated",
    compact: async () => ({
      summary: "",
      droppedMessageCount: 0,
      keptTurns: 1,
      messageCount: 2,
    }),
    send: async () => undefined,
    abort: () => undefined,
    dispose: async () => undefined,
    subscribe: () => () => undefined,
    respondPermission: () => undefined,
    notices: { list: () => [], subscribe: () => () => undefined },
    setMaxContextTokens: () => undefined,
    advanced: {},
  } as unknown as MinClient;
  return {
    controls,
    host: {
      versionLine: "min test",
      providers: {},
      controls,
      client,
      runtime: { maxContextTokens: 256000, modelContextTokens: { "mock-large": 8000 } },
    },
  };
}

describe("executeCommand", () => {
  it("reports the current session and queue", async () => {
    const { host: commandHost } = host();
    const session = await executeCommand(commandHost, { type: "session" });
    expect(session.message).toContain("session sess");
    expect(session.message).toContain("title:    Demo");
    const queue = await executeCommand(commandHost, { type: "queue" });
    expect(queue.message).toContain("[0] follow up");
  });

  it("opens the model picker and applies a typed model", async () => {
    const { host: commandHost, controls } = host();
    expect(await executeCommand(commandHost, { type: "model-pick" })).toEqual({
      picker: "models",
    });
    const set = await executeCommand(commandHost, {
      type: "model-set",
      args: ["mock-large"],
    });
    expect(set.level).toBe("sys");
    expect(controls.selection().model).toBe("mock-large");
  });

  it("sets thinking intensity from the menu key", () => {
    const { host: commandHost, controls } = host();
    const result = selectModel(commandHost, "model:mock-large", "high");
    expect(result.level).toBe("sys");
    expect(controls.selection()).toMatchObject({ model: "mock-large", effort: "high" });
    const cleared = selectModel(commandHost, "model:mock", "default");
    expect(cleared.level).toBe("sys");
    expect(controls.selection().effort).toBeUndefined();
  });

  it("rejects an unknown effort", async () => {
    const { host: commandHost } = host();
    const result = await executeCommand(commandHost, { type: "effort-set", value: "turbo" });
    expect(result.level).toBe("error");
  });
});
