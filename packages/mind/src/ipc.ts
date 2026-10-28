import type { Socket } from "node:net";

export function writeNdjson(socket: Socket, value: unknown): void {
  if (socket.destroyed || !socket.writable) return;
  socket.write(`${JSON.stringify(value)}\n`);
}

export function attachNdjson(
  socket: Socket,
  onMessage: (value: unknown) => void,
): void {
  let buf = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buf += chunk;
    let idx = buf.indexOf("\n");
    while (idx >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) {
        try {
          onMessage(JSON.parse(line) as unknown);
        } catch {
          // drop malformed lines
        }
      }
      idx = buf.indexOf("\n");
    }
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
