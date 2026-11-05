import { afterEach, describe, expect, it, vi } from "vitest";
import { clampScroll, createScrollPump, SCROLL_FLUSH_MS } from "./scroll-pump.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createScrollPump", () => {
  it("merges several wheel ticks into one paint", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const pump = createScrollPump(apply);
    pump.add(3);
    pump.add(3);
    pump.add(-3);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SCROLL_FLUSH_MS);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(3);
    pump.dispose();
  });

  it("flushes on demand and drops a pending burst on dispose", () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const pump = createScrollPump(apply);
    expect(SCROLL_FLUSH_MS).toBe(32);
    pump.add(3);
    pump.flush();
    expect(apply).toHaveBeenCalledWith(3);
    pump.add(6);
    pump.dispose();
    vi.advanceTimersByTime(SCROLL_FLUSH_MS);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(clampScroll(0, -3, 10)).toBe(0);
    expect(clampScroll(8, 4, 10)).toBe(10);
  });
});
