import { afterEach, describe, expect, it, vi } from "vitest";
import { createScrollPump, SCROLL_FLUSH_MS } from "./scroll-pump.js";

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
});
