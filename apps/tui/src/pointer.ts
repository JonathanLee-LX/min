/** OSC 22 pointer shapes. `text` is the I-beam; `default` is the arrow. */
export type PointerShape = "text" | "default";

let current: PointerShape | "" = "";

export function pointerSequence(shape: PointerShape | ""): string {
  return `\x1b]22;${shape}\x07`;
}

export function setPointerShape(
  shape: PointerShape | "",
  stream: NodeJS.WriteStream = process.stdout,
): void {
  if (current === shape) return;
  current = shape;
  if (!stream.isTTY) return;
  stream.write(pointerSequence(shape));
}

export function resetPointerShape(stream: NodeJS.WriteStream = process.stdout): void {
  if (current === "") return;
  current = "";
  if (!stream.isTTY) return;
  stream.write(pointerSequence(""));
}
