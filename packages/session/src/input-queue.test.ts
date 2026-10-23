import { describe, expect, it, vi } from "vitest";
import { createInputQueue } from "./input-queue.js";

describe("InputQueue", () => {
  it("enqueues each push by default", () => {
    const q = createInputQueue({ mode: "enqueue" });
    q.push("a");
    q.push("b");
    expect(q.drain()).toEqual(["a", "b"]);
    expect(q.size).toBe(0);
  });

  it("dense-latest keeps only the newest", () => {
    const q = createInputQueue({ mode: "dense-latest" });
    q.push("old");
    q.push("new");
    expect(q.drain()).toEqual(["new"]);
  });

  it("dense-concat merges into one bubble", () => {
    const q = createInputQueue({ mode: "dense-concat" });
    q.push("alpha");
    q.push("beta");
    expect(q.drain()).toEqual(["alpha\nbeta"]);
  });

  it("denseWindowMs auto-switches to dense-latest", () => {
    vi.useFakeTimers();
    const q = createInputQueue({
      mode: "enqueue",
      denseWindowMs: 1000,
      denseMode: "dense-latest",
    });
    q.push("first");
    vi.advanceTimersByTime(200);
    q.push("second"); // within window → replace
    expect(q.peek()).toEqual(["second"]);
    vi.advanceTimersByTime(1500);
    q.push("third"); // outside window → enqueue
    expect(q.drain()).toEqual(["second", "third"]);
    vi.useRealTimers();
  });

  it("per-push mode override wins", () => {
    const q = createInputQueue({ mode: "enqueue" });
    q.push("a");
    q.push("b", { mode: "dense-latest" });
    expect(q.drain()).toEqual(["b"]);
  });
});
