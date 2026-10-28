import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamPump } from "./stream-pump.js";

describe("createStreamPump", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("paints a burst once, after the chunks have landed", () => {
    vi.useFakeTimers();
    const flushed: string[] = [];
    const pump = createStreamPump((text) => flushed.push(text));
    pump.push("Hel");
    pump.push("lo");
    pump.push(" there");
    expect(flushed).toEqual([]);
    vi.advanceTimersByTime(48);
    expect(flushed).toEqual(["Hello there"]);
  });

  it("paints the next burst on its own", () => {
    vi.useFakeTimers();
    const flushed: string[] = [];
    const pump = createStreamPump((text) => flushed.push(text));
    pump.push("Hello");
    vi.advanceTimersByTime(48);
    pump.push("!");
    vi.advanceTimersByTime(48);
    expect(flushed).toEqual(["Hello", "Hello!"]);
  });

  it("drops a pending paint when the turn is committed", () => {
    vi.useFakeTimers();
    const flushed: string[] = [];
    const pump = createStreamPump((text) => flushed.push(text));
    pump.push("partial");
    expect(pump.take()).toBe("partial");
    vi.runAllTimers();
    expect(flushed).toEqual([]);
  });
});