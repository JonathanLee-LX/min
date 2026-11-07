import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function shortenPath(cwd: string, home = homedir()): string {
  const path = cwd.trim() || ".";
  if (home && (path === home || path.startsWith(`${home}/`))) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

export async function readGitBranch(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "branch", "--show-current"], {
      encoding: "utf8",
      timeout: 1500,
      windowsHide: true,
    });
    const branch = stdout.trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}
