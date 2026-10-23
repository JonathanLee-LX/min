import { describe, expect, it, vi } from "vitest";
import { handleReplCommand } from "./repl.js";
import type { CliClient } from "./run.js";

function fakeCli(
  overrides?: Partial<CliClient["client"]>,
): CliClient {
  const reset = vi.fn();
  return {
    args: {} as CliClient["args"],
    client: {
      reset,
      queue: { size: 0, peek: () => [], push: vi.fn(), clear: vi.fn() },
      getSession: () => ({
        id: "ses_test",
        title: "hello",
        messageCount: 1,
        messages: [],
      }),
      getStatus: () => ({
        status: "idle" as const,
        busy: false,
        provider: "mock",
        sessionId: "ses_test",
        queueSize: 0,
        cwd: "/tmp",
      }),
      ...overrides,
    } as unknown as CliClient["client"],
  };
}

describe("handleReplCommand", () => {
  it("exits on /exit and /quit", () => {
    const cli = fakeCli();
    expect(handleReplCommand(cli, "/exit")).toEqual({ type: "exit" });
    expect(handleReplCommand(cli, "/quit")).toEqual({ type: "exit" });
  });

  it("resets session on /reset", () => {
    const cli = fakeCli();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(handleReplCommand(cli, "/reset")).toEqual({ type: "handled" });
    expect(cli.client.reset).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("ignores non-commands", () => {
    expect(handleReplCommand(fakeCli(), "hello")).toBeNull();
  });
});
