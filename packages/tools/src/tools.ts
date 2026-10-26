import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineTool, type Tool } from "@min-agent/core";
import { z } from "zod";
import { createSandbox, SandboxError, type Sandbox } from "./sandbox.js";

export interface WorkspaceToolsOptions {
  /** Sandbox root (default: process.cwd()). */
  root?: string;
  /** Max bash runtime in ms (default: 30_000). */
  bashTimeoutMs?: number;
  /** Max bytes returned by read_file (default: 200_000). */
  maxReadBytes?: number;
}

export function createWorkspaceTools(
  opts: WorkspaceToolsOptions = {},
): { sandbox: Sandbox; tools: Tool[] } {
  const sandbox = createSandbox(opts.root ?? process.cwd());
  const bashTimeoutMs = opts.bashTimeoutMs ?? 30_000;
  const maxReadBytes = opts.maxReadBytes ?? 200_000;

  const read_file = defineTool({
    name: "read_file",
    description: "Read a UTF-8 text file inside the workspace.",
    inputSchema: z.object({
      path: z.string().describe("Path relative to workspace root"),
    }),
    async execute({ path: userPath }) {
      try {
        const abs = sandbox.resolve(userPath);
        const buf = await readFile(abs);
        if (buf.byteLength > maxReadBytes) {
          return {
            content: `File too large (${buf.byteLength} bytes; max ${maxReadBytes})`,
            isError: true,
          };
        }
        return { content: buf.toString("utf8") };
      } catch (err) {
        return toolError(err);
      }
    },
  });

  const write_file = defineTool({
    name: "write_file",
    description: "Write a UTF-8 text file inside the workspace (creates parents).",
    inputSchema: z.object({
      path: z.string().describe("Path relative to workspace root"),
      content: z.string().describe("File contents"),
    }),
    async execute({ path: userPath, content }) {
      try {
        const abs = sandbox.resolve(userPath);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf8");
        return { content: `Wrote ${sandbox.relative(abs)} (${content.length} chars)` };
      } catch (err) {
        return toolError(err);
      }
    },
  });

  const glob = defineTool({
    name: "glob",
    description:
      "List files and directories under a path (non-recursive by default). Directories end with /.",
    inputSchema: z.object({
      dir: z
        .string()
        .default(".")
        .describe("Directory relative to workspace root"),
      filter: z
        .string()
        .optional()
        .describe("Optional substring filter on entry names"),
      recursive: z
        .boolean()
        .default(false)
        .describe("Recurse into subdirectories"),
      limit: z.number().int().positive().max(500).default(100),
    }),
    async execute(input) {
      const dir = input.dir ?? ".";
      const recursive = input.recursive ?? false;
      const limit = input.limit ?? 100;
      try {
        const start = sandbox.resolve(dir);
        const matches: string[] = [];
        await walk(start, recursive, (abs, name, isDir) => {
          if (input.filter && !name.includes(input.filter)) return;
          const rel = sandbox.relative(abs);
          matches.push(isDir ? `${rel}/` : rel);
        });
        const sliced = matches.slice(0, limit);
        const more =
          matches.length > limit ? `\n…and ${matches.length - limit} more` : "";
        return {
          content: sliced.length
            ? sliced.join("\n") + more
            : "(no matches)",
        };
      } catch (err) {
        return toolError(err);
      }
    },
  });

  const bash = defineTool({
    name: "bash",
    description:
      "Run a shell command with cwd set to the workspace root. Prefer simple, non-interactive commands.",
    inputSchema: z.object({
      command: z.string().describe("Shell command to run"),
    }),
    async execute({ command }) {
      try {
        const result = await runBash(command, sandbox.root, bashTimeoutMs);
        const parts = [
          result.stdout.trimEnd(),
          result.stderr.trimEnd()
            ? `stderr:\n${result.stderr.trimEnd()}`
            : "",
          `exit_code=${result.code}`,
        ].filter(Boolean);
        return {
          content: parts.join("\n\n") || `(exit ${result.code})`,
          isError: result.code !== 0,
        };
      } catch (err) {
        return toolError(err);
      }
    },
  });

  return { sandbox, tools: [read_file, write_file, glob, bash] };
}

async function walk(
  dir: string,
  recursive: boolean,
  visit: (abs: string, name: string, isDir: boolean) => void,
): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === ".git" ||
      entry.name === "node_modules" ||
      entry.name === ".min"
    ) {
      continue;
    }
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      visit(abs, entry.name, true);
      if (recursive) await walk(abs, true, visit);
    } else if (entry.isFile()) {
      visit(abs, entry.name, false);
    }
  }
}

function runBash(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const max = 200_000;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < max) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < max) stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`bash timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

function toolError(err: unknown) {
  if (err instanceof SandboxError) {
    return { content: err.message, isError: true };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { content: message, isError: true };
}
