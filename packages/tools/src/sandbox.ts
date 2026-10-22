import path from "node:path";

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export interface Sandbox {
  /** Absolute resolved root. */
  readonly root: string;
  /** Resolve a user path into an absolute path inside the sandbox. */
  resolve(userPath: string): string;
  /** Relative path from root (posix-ish display). */
  relative(absPath: string): string;
}

export function createSandbox(root: string): Sandbox {
  const resolvedRoot = path.resolve(root);

  return {
    root: resolvedRoot,

    resolve(userPath: string): string {
      const candidate = path.resolve(
        resolvedRoot,
        userPath.trim() === "" ? "." : userPath,
      );
      const rel = path.relative(resolvedRoot, candidate);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new SandboxError(
          `Path escapes sandbox root (${resolvedRoot}): ${userPath}`,
        );
      }
      return candidate;
    },

    relative(absPath: string): string {
      const rel = path.relative(resolvedRoot, absPath);
      return rel === "" ? "." : rel;
    },
  };
}
