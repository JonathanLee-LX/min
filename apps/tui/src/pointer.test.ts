import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pointerSequence, resetPointerShape, setPointerShape } from "./pointer.js";

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

beforeEach(() => {
  resetPointerShape(tty());
});

afterEach(() => {
  resetPointerShape(tty());
});

describe("pointer shape", () => {
  it("writes OSC 22 text for the I-beam and skips repeats", () => {
    const stream = tty();
    setPointerShape("text", stream);
    expect(stream.writes).toEqual([pointerSequence("text")]);
    setPointerShape("text", stream);
    expect(stream.writes).toEqual([pointerSequence("text")]);
    setPointerShape("default", stream);
    expect(stream.writes[1]).toBe(pointerSequence("default"));
  });

  it("resets with an empty OSC 22 and does not write to a non-TTY", () => {
    const stream = tty();
    setPointerShape("text", stream);
    stream.writes.length = 0;
    resetPointerShape(stream);
    expect(stream.writes).toEqual([pointerSequence("")]);
    resetPointerShape(stream);
    expect(stream.writes).toEqual([pointerSequence("")]);

    const plain = tty(false);
    setPointerShape("text", plain);
    expect(plain.writes).toEqual([]);
  });
});
