import { describe, expect, it, vi } from "vitest";
import { createPermissionBridge } from "./permission-bridge.js";

const toolCall = {
  type: "tool_call" as const,
  id: "t1",
  name: "bash",
  arguments: { command: "ls" },
};

describe("createPermissionBridge", () => {
  it("resolves when respond is called", async () => {
    const onAsk = vi.fn();
    const bridge = createPermissionBridge({ timeoutMs: 0, onAsk });
    const p = bridge.ask({ toolCall, reason: "run bash" });
    expect(onAsk).toHaveBeenCalledOnce();
    const id = onAsk.mock.calls[0]![0].id as string;
    expect(bridge.respond(id, "allow")).toBe(true);
    await expect(p).resolves.toBe("allow");
    expect(bridge.size).toBe(0);
  });

  it("lists pending asks and reports resolve via onResolved", async () => {
    const onAsk = vi.fn();
    const onResolved = vi.fn();
    const bridge = createPermissionBridge({ timeoutMs: 0, onAsk, onResolved });
    const p = bridge.ask({ toolCall, reason: "run bash" });
    expect(bridge.list()).toHaveLength(1);
    expect(bridge.list()[0]?.reason).toBe("run bash");
    const id = onAsk.mock.calls[0]![0].id as string;
    expect(bridge.respond(id, "deny")).toBe(true);
    await p;
    expect(onResolved).toHaveBeenCalledWith(id, "deny");
    expect(bridge.list()).toEqual([]);
  });

  it("times out to deny", async () => {
    vi.useFakeTimers();
    const bridge = createPermissionBridge({
      timeoutMs: 1000,
      onAsk: () => {},
    });
    const p = bridge.ask({ toolCall, reason: "x" });
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBe("deny");
    vi.useRealTimers();
  });
});
