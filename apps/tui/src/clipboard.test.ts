import { describe, expect, it } from "vitest";
import { copyToClipboard } from "./clipboard.js";

describe("copyToClipboard", () => {
  it("writes OSC 52 for a TTY", () => {
    const writes: string[] = [];
    const stream = {
      isTTY: true,
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WriteStream;
    copyToClipboard("hi", stream);
    expect(writes[0]).toContain("\x1b]52;c;");
    expect(writes[0]).toContain(Buffer.from("hi", "utf8").toString("base64"));
  });
});
