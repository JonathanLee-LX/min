/**
 * Wheel reporting only. Same split Claude Code and OpenCode use:
 * `1000` + `1006` send the wheel so the transcript can scroll.
 * Clicks stay ignored. Drag tracking (`1002`) stays off.
 * Native selection is Shift+drag (Option+drag in VS Code's terminal).
 */

const WHEEL_ON = "\x1b[?1000h\x1b[?1006h";
const ALL_OFF = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";

let wheelOn = false;

function write(stream: NodeJS.WriteStream | undefined, sequence: string): void {
  if (!stream?.isTTY) return;
  stream.write(sequence);
}

export function enableMouseWheel(stream: NodeJS.WriteStream = process.stdout): void {
  if (wheelOn) return;
  write(stream, WHEEL_ON);
  wheelOn = true;
}

export function disableMouse(stream: NodeJS.WriteStream = process.stdout): void {
  write(stream, ALL_OFF);
  wheelOn = false;
}
