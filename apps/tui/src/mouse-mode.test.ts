import { afterEach, describe, expect, it } from "vitest";
import { disableMouse, enableMouseWheel } from "./mouse-mode.js";

function tty(): NodeJS.WriteStream & { writes: string[] } {
  const writes: string[] = [];
  return {
    isTTY: true,
    writes,
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WriteStream & { writes: string[] };
}

afterEach(() => {
  disableMouse(tty());
});

describe("mouse mode", () => {
  it("turns on wheel, button-motion, and hover reporting", () => {
    const stream = tty();
    enableMouseWheel(stream);
    expect(stream.writes.join("")).toContain("\x1b[?1000h");
    expect(stream.writes.join("")).toContain("\x1b[?1002h");
    expect(stream.writes.join("")).toContain("\x1b[?1003h");
    expect(stream.writes.join("")).toContain("\x1b[?1006h");
    expect(stream.writes.join("")).toContain("\x1b]22;text\x07");
    stream.writes.length = 0;
    enableMouseWheel(stream);
    expect(stream.writes).toEqual([]);
  });

  it("turns reporting off on exit", () => {
    const stream = tty();
    enableMouseWheel(stream);
    stream.writes.length = 0;
    disableMouse(stream);
    expect(stream.writes.join("")).toBe("\x1b]22;\x07\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l");
  });
});
