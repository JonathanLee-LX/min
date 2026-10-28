import type { Socket } from "node:net";

export function writeNdjson(socket: Socket, value: unknown): void {
  socket.write(`${JSON.stringify(value)}\n`);
}

export function readNdjson(
  socket: Socket,
  onMessage: (value: unknown) => void,
): void {
  let buf = "";
  socket.on("data", (chunk: Buffer | string) => {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          onMessage(JSON.parse(line) as unknown);
        } catch {
          // Ignore malformed frames; the caller times out its own request.
        }
      }
      nl = buf.indexOf("\n");
    }
  });
}
