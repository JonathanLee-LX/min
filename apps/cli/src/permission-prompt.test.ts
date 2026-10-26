import { createInterface } from "node:readline/promises";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  attachFollowUpQueue,
  permissionAnswerFromLine,
  type CliClient,
} from "./run.js";

describe("permission answer line", () => {
  it("maps y / a / anything else", () => {
    expect(permissionAnswerFromLine("y")).toBe("allow");
    expect(permissionAnswerFromLine(" YES ")).toBe("allow");
    expect(permissionAnswerFromLine("a")).toBe("allow_session");
    expect(permissionAnswerFromLine("always")).toBe("allow_session");
    expect(permissionAnswerFromLine("n")).toBe("deny");
    expect(permissionAnswerFromLine("")).toBe("deny");
  });

  it("reads a cooked answer without also queueing it", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const rl = createInterface({ input, output, terminal: false });
    const push = vi.fn();
    const stop = attachFollowUpQueue(rl, {
      queue: { push },
    } as unknown as CliClient["client"]);

    const pending = rl.question("Allow? > ");
    input.write("y\n");
    await expect(pending).resolves.toBe("y");
    expect(push).not.toHaveBeenCalled();

    input.write("follow up\n");
    await new Promise((r) => setTimeout(r, 20));
    expect(push).toHaveBeenCalledWith("follow up");

    stop();
    rl.close();
  });
});
