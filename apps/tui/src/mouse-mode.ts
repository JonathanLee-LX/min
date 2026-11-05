/**
 * Wheel reporting without drag capture.
 *
 * `1000` + `1006` send the wheel to the app so the transcript can scroll.
 * `1002` is left off so a drag is not a motion stream.
 * A left click turns reporting off so the terminal can start a native
 * selection, then reporting comes back after a short pause or the next key.
 */

const WHEEL_ON = "\x1b[?1000h\x1b[?1006h";
const ALL_OFF = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";

/** How long a drag can run as a native selection before the wheel comes back. */
export const MOUSE_SELECT_RESUME_MS = 2500;

let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let wheelOn = false;

function write(stream: NodeJS.WriteStream | undefined, sequence: string): void {
  if (!stream?.isTTY) return;
  stream.write(sequence);
}

function clearResume(): void {
  if (!resumeTimer) return;
  clearTimeout(resumeTimer);
  resumeTimer = null;
}

export function enableMouseWheel(stream: NodeJS.WriteStream = process.stdout): void {
  clearResume();
  if (wheelOn) return;
  write(stream, WHEEL_ON);
  wheelOn = true;
}

export function disableMouse(stream: NodeJS.WriteStream = process.stdout): void {
  clearResume();
  write(stream, ALL_OFF);
  wheelOn = false;
}

/** Drop mouse reporting so the current drag can select text. */
export function releaseMouseForSelect(
  stream: NodeJS.WriteStream = process.stdout,
  resumeMs = MOUSE_SELECT_RESUME_MS,
): void {
  write(stream, ALL_OFF);
  wheelOn = false;
  clearResume();
  resumeTimer = setTimeout(() => {
    resumeTimer = null;
    write(stream, WHEEL_ON);
    wheelOn = true;
  }, resumeMs);
}
