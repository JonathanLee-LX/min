import { spawn } from "node:child_process";

/** Copy `text` through OSC 52 and, when present, the platform clipboard tool. */
export function copyToClipboard(text: string, stream: NodeJS.WriteStream = process.stdout): void {
  if (!text) return;
  if (stream.isTTY) {
    stream.write(`\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`);
  }
  const tools =
    process.platform === "darwin"
      ? [{ cmd: "pbcopy", args: [] as string[] }]
      : process.platform === "win32"
        ? [{ cmd: "clip", args: [] as string[] }]
        : [
            { cmd: "wl-copy", args: [] as string[] },
            { cmd: "xclip", args: ["-selection", "clipboard"] },
          ];
  for (const tool of tools) pipeTo(tool.cmd, tool.args, text);
}

function pipeTo(cmd: string, args: string[], text: string): void {
  try {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => {});
    child.stdin?.write(text);
    child.stdin?.end();
  } catch {
    // Missing clipboard tool is fine; OSC 52 still went out.
  }
}
