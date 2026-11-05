import { afterEach, describe, expect, it, vi } from "vitest";
import {
  disableMouse,
  enableMouseWheel,
  MOUSE_SELECT_RESUME_MS,
  releaseMouseForSelect,
} from "./mouse-mode.js";

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
  vi.useRealTimers();
  disableMouse(tty());
});

describe("mouse mode", () => {
  it("turns on wheel reporting without drag tracking", () => {
    const stream = tty();
    enableMouseWheel(stream);
    expect(stream.writes.join("")).toContain("\x1b[?1000h");
    expect(stream.writes.join("")).toContain("\x1b[?1006h");
    expect(stream.writes.join("")).not.toContain("1002h");
  });

  it("releases reporting for a selection and brings the wheel back", () => {
    vi.useFakeTimers();
    const stream = tty();
    enableMouseWheel(stream);
    stream.writes.length = 0;
    releaseMouseForSelect(stream);
    expect(stream.writes.join("")).toContain("\x1b[?1000l");
    stream.writes.length = 0;
    vi.advanceTimersByTime(MOUSE_SELECT_RESUME_MS);
    expect(stream.writes.join("")).toContain("\x1b[?1000h");
  });

  it("clears a pending resume when reporting is disabled", () => {
    vi.useFakeTimers();
    const stream = tty();
    releaseMouseForSelect(stream);
    stream.writes.length = 0;
    disableMouse(stream);
    vi.advanceTimersByTime(MOUSE_SELECT_RESUME_MS);
    expect(stream.writes.join("")).toBe("\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l");
  });
});
