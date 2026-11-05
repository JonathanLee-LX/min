/**
 * SGR mouse with button-motion, the same modes Pi uses for fullscreen
 * selection: wheel scrolls the transcript, and a drag is an app-owned
 * selection that copies on release.
 */

const MOUSE_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
const ALL_OFF = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";

let mouseOn = false;

function write(stream: NodeJS.WriteStream | undefined, sequence: string): void {
  if (!stream?.isTTY) return;
  stream.write(sequence);
}

export function enableMouseWheel(stream: NodeJS.WriteStream = process.stdout): void {
  if (mouseOn) return;
  write(stream, MOUSE_ON);
  mouseOn = true;
}

export function disableMouse(stream: NodeJS.WriteStream = process.stdout): void {
  write(stream, ALL_OFF);
  mouseOn = false;
}
