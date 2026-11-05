/**
 * SGR mouse with button-motion and any-event motion: wheel scrolls,
 * a drag is an app-owned selection, and hover updates the pointer
 * shape (I-beam over transcript text) without a React paint.
 */

import { resetPointerShape, setPointerShape } from "./pointer.js";

const MOUSE_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h";
const ALL_OFF = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";

let mouseOn = false;

function write(stream: NodeJS.WriteStream | undefined, sequence: string): void {
  if (!stream?.isTTY) return;
  stream.write(sequence);
}

export function enableMouseWheel(stream: NodeJS.WriteStream = process.stdout): void {
  if (mouseOn) return;
  write(stream, MOUSE_ON);
  setPointerShape("text", stream);
  mouseOn = true;
}

export function disableMouse(stream: NodeJS.WriteStream = process.stdout): void {
  resetPointerShape(stream);
  write(stream, ALL_OFF);
  mouseOn = false;
}
