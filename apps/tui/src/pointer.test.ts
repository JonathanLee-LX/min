import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pointerSequence, resetPointerShape, setPointerShape } from "./pointer.js";

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
});
