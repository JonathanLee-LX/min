import { describe, expect, it, vi } from "vitest";
import { handleReplCommand } from "./repl.js";
import type { CliRuntime } from "./run.js";

function fakeRuntime(overrides?: Partial<CliRuntime["session"]>): CliRuntime {
  return {
    agent: {} as CliRuntime["agent"],
    args: {} as CliRuntime["args"],
    session: {
      id: "ses_test",
      meta: {
        id: "ses_test",
        title: "hello",
        createdAt: "t0",
        updatedAt: "t1",
      },
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      reset: vi.fn(),
      ...overrides,
    } as unknown as CliRuntime["session"],
  };
}

describe("handleReplCommand", () => {
  it("exits on /exit and /quit", () => {
    const rt = fakeRuntime();
    expect(handleReplCommand(rt, "/exit")).toEqual({ type: "exit" });
    expect(handleReplCommand(rt, "/quit")).toEqual({ type: "exit" });
  });

  it("resets session on /reset", () => {
    const rt = fakeRuntime();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(handleReplCommand(rt, "/reset")).toEqual({ type: "handled" });
    expect(rt.session.reset).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("ignores non-commands", () => {
    expect(handleReplCommand(fakeRuntime(), "hello")).toBeNull();
  });
});
