import { afterEach, describe, expect, it, vi } from "vitest";
import { inputAction } from "./editor.js";
import { createKeyBuffer } from "./key-buffer.js";
import { actionFromChunk, decodeInput } from "./keys.js";
import { applyMouse, pointerShapeForY, scrollDelta, type MouseGeom } from "./mouse-session.js";
import { clampScroll, createScrollPump, SCROLL_FLUSH_MS } from "./scroll-pump.js";

const geom: MouseGeom = {
  paddingX: 1,
  logHeight: 8,
  rowCount: 3,
  rowWidth: 20,
  lines: ["  hello world", "  second line", "  third"],
};

function mouse(chunk: string) {
  const key = decodeInput(chunk).key;
  expect(key.mouse, chunk).toBeDefined();
  return key.mouse!;
}

function play(chunks: readonly string[], start: ReturnType<typeof applyMouse>["selection"] = null) {
  let selection = start;
  const steps = chunks.map((chunk) => {
    const next = applyMouse(mouse(chunk), geom, selection);
    selection = next.selection;
    return next;
  });
  return { steps, selection };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pointerShapeForY", () => {
  it("is an I-beam on transcript rows and an arrow on chrome", () => {
    expect(pointerShapeForY(0, 8)).toBe("text");
    expect(pointerShapeForY(7, 8)).toBe("text");
    expect(pointerShapeForY(8, 8)).toBe("default");
    expect(pointerShapeForY(20, 8)).toBe("default");
  });
});

describe("applyMouse", () => {
  it("hover over text is an I-beam and does not start a selection", () => {
    const held = {
      anchor: { row: 0, col: 0 },
      focus: { row: 0, col: 4 },
      dragging: false,
    };
    const next = applyMouse(mouse("\x1b[<35;5;2M"), geom, held);
    expect(next.pointer).toBe("text");
    expect(next.selection).toBe(held);
    expect(next.copy).toBe("");
    expect(inputAction("", decodeInput("\x1b[<35;5;2M").key)).toEqual({ type: "ignore" });
  });

  it("hover over the composer is an arrow and leaves a highlight alone", () => {
    const held = {
      anchor: { row: 0, col: 0 },
      focus: { row: 0, col: 5 },
      dragging: false,
    };
    const next = applyMouse(mouse("\x1b[<35;4;12M"), geom, held);
    expect(next.pointer).toBe("default");
    expect(next.selection).toBe(held);
    expect(next.copy).toBe("");
  });

  it("drag-selects transcript text and copies on release, without Shift", () => {
    const { steps, selection } = play(["\x1b[<0;4;1M", "\x1b[<32;9;1M", "\x1b[<0;9;1m"]);
    expect(steps[0]).toMatchObject({
      pointer: "text",
      copy: "",
      selection: { anchor: { row: 0, col: 2 }, focus: { row: 0, col: 2 }, dragging: true },
    });
    expect(steps[1]?.selection).toMatchObject({
      focus: { row: 0, col: 7 },
      dragging: true,
    });
    expect(steps[2]?.copy).toBe("hello");
    expect(selection).toEqual({
      anchor: { row: 0, col: 2 },
      focus: { row: 0, col: 7 },
      dragging: false,
    });
  });

  it("a click with no range clears and does not copy", () => {
    const { steps } = play(["\x1b[<0;4;2M", "\x1b[<0;4;2m"]);
    expect(steps[1]).toEqual({ pointer: "text", selection: null, copy: "" });
  });

  it("pressing in chrome clears an existing selection", () => {
    const held = {
      anchor: { row: 0, col: 0 },
      focus: { row: 0, col: 5 },
      dragging: false,
    };
    const next = applyMouse(mouse("\x1b[<0;4;12M"), geom, held);
    expect(next).toEqual({ pointer: "default", selection: null, copy: "" });
  });

  it("motion without a prior press does not start a drag", () => {
    expect(applyMouse(mouse("\x1b[<32;8;1M"), geom, null).selection).toBeNull();
  });

  it("release without a drag does not copy", () => {
    const held = {
      anchor: { row: 0, col: 0 },
      focus: { row: 0, col: 5 },
      dragging: false,
    };
    expect(applyMouse(mouse("\x1b[<0;8;1m"), geom, held)).toEqual({
      pointer: "text",
      selection: held,
      copy: "",
    });
  });
});

describe("scroll from decoded input", () => {
  it("wheels three rows and pages by the viewport height", () => {
    expect(actionFromChunk("\x1b[<64;12;8M")).toEqual({
      type: "scroll",
      direction: "up",
      delta: 3,
    });
    expect(actionFromChunk("\x1b[<65;12;8M")).toEqual({
      type: "scroll",
      direction: "down",
      delta: 3,
    });
    expect(scrollDelta("up", 3, 20)).toBe(3);
    expect(scrollDelta("down", 3, 20)).toBe(-3);
    expect(scrollDelta("up", undefined, 20)).toBe(20);
    expect(scrollDelta("down", undefined, 20)).toBe(-20);
  });

  it("merges a wheel burst into one clamped paint", () => {
    vi.useFakeTimers();
    const paints: number[] = [];
    const pump = createScrollPump((delta) => {
      paints.push(clampScroll(paints.at(-1) ?? 0, delta, 40));
    });
    for (const chunk of ["\x1b[<64;1;1M", "\x1b[<64;1;1M", "\x1b[<65;1;1M", "\x1b[<64;1;1M"]) {
      const action = actionFromChunk(chunk);
      expect(action.type).toBe("scroll");
      if (action.type === "scroll") pump.add(scrollDelta(action.direction, action.delta, 20));
    }
    expect(paints).toEqual([]);
    vi.advanceTimersByTime(SCROLL_FLUSH_MS);
    expect(paints).toEqual([6]);
    pump.dispose();
  });

  it("clamps scroll to the transcript", () => {
    expect(clampScroll(0, -3, 10)).toBe(0);
    expect(clampScroll(9, 3, 10)).toBe(10);
    expect(clampScroll(4, 3, 10)).toBe(7);
  });
});

describe("SGR mouse sequences", () => {
  it("reassembles a split hover report", () => {
    const sequences: string[] = [];
    const buffer = createKeyBuffer((sequence) => sequences.push(sequence));
    buffer.push("\x1b[<35;5;");
    expect(sequences).toEqual([]);
    buffer.push("2M");
    expect(sequences).toEqual(["\x1b[<35;5;2M"]);
    expect(decodeInput(sequences[0]!).key.mouse).toEqual({ kind: "move", x: 4, y: 1 });
    buffer.dispose();
  });

  it("ignores wheel releases and unused buttons", () => {
    expect(actionFromChunk("\x1b[<64;12;8m")).toEqual({ type: "ignore" });
    expect(decodeInput("\x1b[<1;4;2M").key.mouse).toBeUndefined();
    expect(decodeInput("\x1b[<2;4;2M").key.mouse).toBeUndefined();
  });
});
