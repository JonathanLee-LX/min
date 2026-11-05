import { describe, expect, it } from "vitest";
import {
  ALT_SCREEN_ENTER,
  ALT_SCREEN_LEAVE,
  enterAltScreen,
} from "./alt-screen.js";

function tty(isTTY = true): NodeJS.WriteStream & { writes: string[] } {
  const writes: string[] = [];
  return {
    isTTY,
    writes,
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WriteStream & { writes: string[] };
}

describe("enterAltScreen", () => {
  it("enters the alternate buffer and leaves once", () => {
    const stream = tty();
    const leave = enterAltScreen(stream);
    expect(stream.writes).toEqual([ALT_SCREEN_ENTER]);
    stream.writes.length = 0;
    leave();
    leave();
    expect(stream.writes).toEqual([ALT_SCREEN_LEAVE]);
  });

  it("does not write when stdout is not a TTY", () => {
    const stream = tty(false);
    const leave = enterAltScreen(stream);
    leave();
    expect(stream.writes).toEqual([]);
  });
});
