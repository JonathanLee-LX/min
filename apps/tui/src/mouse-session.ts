import type { PointerShape } from "./pointer.js";
import { cellFromMouse, clampCell, selectedText, type SelCell } from "./selection.js";

export interface MouseGeom {
  paddingX: number;
  logHeight: number;
  rowCount: number;
  rowWidth: number;
  lines: readonly string[];
}

export interface SelectionDrag {
  anchor: SelCell;
  focus: SelCell;
  dragging: boolean;
}

export interface MouseEvent {
  kind: "down" | "drag" | "move" | "up";
  x: number;
  y: number;
}

export interface MouseResult {
  pointer: PointerShape;
  selection: SelectionDrag | null;
  copy: string;
}

/** I-beam on the transcript, arrow on composer/status chrome. */
export function pointerShapeForY(y: number, logHeight: number): PointerShape {
  return y < logHeight ? "text" : "default";
}

/**
 * App-owned selection and pointer, matching Pi: hover only changes
 * the pointer; a drag copies on release and keeps the highlight.
 */
export function applyMouse(
  event: MouseEvent,
  geom: MouseGeom,
  current: SelectionDrag | null,
): MouseResult {
  const pointer = pointerShapeForY(event.y, geom.logHeight);
  if (event.kind === "move") {
    return { pointer, selection: current, copy: "" };
  }
  if (event.kind === "down") {
    const cell = cellFromMouse(event.x, event.y, geom);
    return {
      pointer,
      selection: cell ? { anchor: cell, focus: cell, dragging: true } : null,
      copy: "",
    };
  }
  if (event.kind === "drag") {
    if (!current?.dragging) return { pointer, selection: current, copy: "" };
    const cell = clampCell(event.x, event.y, geom);
    return { pointer, selection: cell ? { ...current, focus: cell } : current, copy: "" };
  }
  if (!current?.dragging) return { pointer, selection: current, copy: "" };
  const cell = clampCell(event.x, event.y, geom) ?? current.focus;
  const copy = selectedText(geom.lines, current.anchor, cell);
  return {
    pointer,
    selection: copy ? { anchor: current.anchor, focus: cell, dragging: false } : null,
    copy,
  };
}

/** Wheel uses an explicit delta; PageUp/Down use the viewport height. */
export function scrollDelta(
  direction: "up" | "down",
  delta: number | undefined,
  viewHeight: number,
): number {
  const step = delta ?? Math.max(1, viewHeight);
  return direction === "up" ? step : -step;
}
