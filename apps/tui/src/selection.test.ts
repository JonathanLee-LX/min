import { describe, expect, it } from "vitest";
import {
  cellFromMouse,
  clampCell,
  rowSelectionCols,
  selectedText,
  selectionRange,
} from "./selection.js";

const frame = { paddingX: 1, logHeight: 8, rowCount: 3, rowWidth: 20 };

describe("cellFromMouse", () => {
  it("maps a transcript cell and ignores chrome", () => {
    expect(cellFromMouse(4, 1, frame)).toEqual({ row: 1, col: 3 });
    expect(cellFromMouse(0, 1, frame)).toEqual({ row: 1, col: 0 });
    expect(cellFromMouse(4, 8, frame)).toBeNull();
    expect(cellFromMouse(4, 3, frame)).toBeNull();
  });

  it("clamps a drag that leaves the transcript", () => {
    expect(clampCell(4, 20, frame)).toEqual({ row: 2, col: 3 });
    expect(clampCell(80, 0, frame)).toEqual({ row: 0, col: 20 });
  });
});

describe("selectedText", () => {
  const lines = ["hello world", "你好", "third"];

  it("takes a range on one row", () => {
    expect(selectedText(lines, { row: 0, col: 0 }, { row: 0, col: 5 })).toBe("hello");
  });

  it("joins multiple rows and uses display columns for CJK", () => {
    expect(selectedText(lines, { row: 1, col: 0 }, { row: 1, col: 2 })).toBe("你");
    expect(selectedText(lines, { row: 0, col: 6 }, { row: 2, col: 5 })).toBe("world\n你好\nthird");
  });

  it("is empty when the anchor and focus are the same cell", () => {
    expect(selectedText(lines, { row: 0, col: 2 }, { row: 0, col: 2 })).toBe("");
    expect(selectionRange({ row: 0, col: 2 }, { row: 0, col: 2 })).toBeNull();
  });

  it("covers a full middle row", () => {
    const range = selectionRange({ row: 0, col: 1 }, { row: 2, col: 2 })!;
    expect(rowSelectionCols(1, range, 10)).toEqual({ start: 0, end: 10 });
  });
});
