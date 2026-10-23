import fs from "node:fs";
import path from "node:path";

export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export type ProbeResult =
  | { ok: true; abs: string; root: string }
  | { ok: false; abs: string; suggestedRoot: string };

export interface Sandbox {
  /** Primary sandbox root (immutable). */
  readonly root: string;
  /** Session-granted additional roots. */
  readonly sessionRoots: readonly string[];
  /** Resolve a user path into an absolute path inside an allowed root. */
  resolve(userPath: string): string;
  /** Probe without throwing — used by the permission layer. */
  probe(userPath: string): ProbeResult;
  /** Grant a directory as a session root (normalized + realpath when possible). */
  grantRoot(absDir: string): void;
  /** Seed roots at startup (same as grantRoot). */
  addRoots(dirs: string[]): void;
  clearSessionRoots(): void;
  /** Display path relative to the containing root, or absolute if outside primary. */
  relative(absPath: string): string;
}

export function createSandbox(root: string): Sandbox {
  const primaryRoot = realpathExisting(path.resolve(root));
  const sessionRoots: string[] = [];

  const allRoots = (): string[] => [primaryRoot, ...sessionRoots];

  const probe = (userPath: string): ProbeResult => {
    const abs = canonicalize(primaryRoot, userPath);
    for (const r of allRoots()) {
      if (isContained(abs, r)) {
        return { ok: true, abs, root: r };
      }
    }
    return {
      ok: false,
      abs,
      suggestedRoot: suggestRoot(abs, userPath),
    };
  };

  return {
    get root() {
      return primaryRoot;
    },
    get sessionRoots() {
      return sessionRoots;
    },

    probe,

    resolve(userPath: string): string {
      const result = probe(userPath);
      if (!result.ok) {
        throw new SandboxError(
          `Path escapes sandbox roots (${allRoots().join(", ")}): ${userPath}`,
        );
      }
      return result.abs;
    },

    grantRoot(absDir: string): void {
      const normalized = realpathExisting(path.resolve(absDir));
      if (isContained(normalized, primaryRoot)) return;
      if (sessionRoots.some((r) => r === normalized)) return;
      // Drop roots that are children of the new grant (keep set tight but non-redundant)
      for (let i = sessionRoots.length - 1; i >= 0; i--) {
        const r = sessionRoots[i]!;
        if (isContained(r, normalized)) sessionRoots.splice(i, 1);
      }
      sessionRoots.push(normalized);
    },

    addRoots(dirs: string[]): void {
      for (const d of dirs) this.grantRoot(d);
    },

    clearSessionRoots(): void {
      sessionRoots.length = 0;
    },

    relative(absPath: string): string {
      const abs = path.resolve(absPath);
      if (isContained(abs, primaryRoot)) {
        const rel = path.relative(primaryRoot, abs);
        return rel === "" ? "." : rel;
      }
      for (const r of sessionRoots) {
        if (isContained(abs, r)) {
          return path.resolve(abs);
        }
      }
      return abs;
    },
  };
}

/** Resolve user path then realpath when possible (symlink-safe). */
function canonicalize(primaryRoot: string, userPath: string): string {
  const trimmed = userPath.trim() === "" ? "." : userPath;
  const candidate = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(primaryRoot, trimmed);
  return realpathExisting(candidate);
}

function realpathExisting(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    // Target may not exist yet (write_file). Realpath the nearest existing ancestor.
    let dir = path.dirname(p);
    const parts = [path.basename(p)];
    while (dir !== path.dirname(dir)) {
      try {
        const realDir = fs.realpathSync(dir);
        return path.join(realDir, ...parts.reverse());
      } catch {
        parts.push(path.basename(dir));
        dir = path.dirname(dir);
      }
    }
    return path.resolve(p);
  }
}

function isContained(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

function suggestRoot(abs: string, userPath: string): string {
  // Trailing slash / explicit dir intent → grant that directory
  if (userPath.endsWith("/") || userPath.endsWith(path.sep)) {
    return realpathExisting(abs);
  }
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      return realpathExisting(abs);
    }
  } catch {
    // ignore
  }
  return realpathExisting(path.dirname(abs));
}
