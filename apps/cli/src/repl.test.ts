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

  it("routes session switch commands", () => {
    const cli = fakeCli();
    expect(handleReplCommand(cli, "/sessions")).toEqual({ type: "sessions" });
    expect(handleReplCommand(cli, "/new")).toEqual({ type: "new" });
    expect(handleReplCommand(cli, "/resume ses_abc")).toEqual({
      type: "resume",
      id: "ses_abc",
    });
    expect(handleReplCommand(cli, "/open ses_abc")).toEqual({
      type: "resume",
      id: "ses_abc",
    });
    expect(handleReplCommand(cli, "/resume")).toEqual({ type: "resume-list" });
  });

  it("routes /compact", () => {
    expect(handleReplCommand(fakeCli(), "/compact")).toEqual({
      type: "compact",
    });
  });

  it("prints /context and /version", () => {
    const cli = fakeCli({
      getStatus: () => ({
        status: "idle" as const,
        busy: false,
        provider: "mock",
        sessionId: "ses_test",
        queueSize: 0,
        cwd: "/tmp",
        context: {
          used: 100,
          limit: 1000,
          ratio: 0.1,
          reservedOutput: 50,
          estimated: true,
          strategy: "trim",
          parts: [
            { id: "system" as const, label: "system", tokens: 40, share: 0.4 },
            { id: "conversation" as const, label: "conversation", tokens: 60, share: 0.6 },
            { id: "reserved" as const, label: "reserved", tokens: 50, share: 0.05 },
          ],
        },
      }),
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(handleReplCommand(cli, "/context")).toEqual({ type: "handled" });
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/ctx /);
    expect(handleReplCommand(cli, "/version")).toEqual({ type: "handled" });
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/^min /);
    log.mockRestore();
  });
});
