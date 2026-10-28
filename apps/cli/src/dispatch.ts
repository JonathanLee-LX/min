import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type MinMode = "help" | "cli" | "tui";

/** Flags whose next argv token is a value (not a bare positional prompt). */
const VALUE_FLAGS = new Set([
  "-p",
  "--prompt",
  "--provider",
  "--model",
  "--cwd",
  "--session",
  "--session-dir",
  "--skills",
  "--theme",
  "--add-root",
  "--max-context-tokens",
  "--max-user-turns",
  "--max-turns",
  "--context-strategy",
]);

/**
 * Decide whether `min` should open the TUI, run the CLI, or print top-level help.
 *
 * - default → TUI
 * - `-p` / `--prompt`, `-i` / `--repl`, `--list-sessions` → CLI
 * - bare `-h` / `--help` (no CLI mode flags) → combined help
 */
export function resolveMinMode(argv: string[]): MinMode {
  let prompt = false;
  let repl = false;
  let listSessions = false;
  let help = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    if (a === "-p" || a === "--prompt") {
      prompt = true;
      i += 1;
      continue;
    }
    if (a.startsWith("--prompt=")) {
      prompt = true;
      continue;
    }
    if (a === "-i" || a === "--repl") {
      repl = true;
      continue;
    }
    if (a === "--list-sessions") {
      listSessions = true;
      continue;
    }
    if (a === "-h" || a === "--help") {
      help = true;
      continue;
    }
    if (VALUE_FLAGS.has(a)) {
      i += 1;
      continue;
    }
    if (a.startsWith("-")) continue;
    positional.push(a);
  }

  if (prompt || repl || listSessions) return "cli";
  if (help) return "help";
  if (positional.length > 0) {
    throw new Error(
      `unexpected arguments: ${positional.join(" ")}\n` +
        `  open the TUI with:  min\n` +
        `  one-shot prompt:    min -p "your prompt"\n` +
        `  interactive REPL:   min -i`,
    );
  }
  return "tui";
}

export function combinedHelpText(): string {
  return `min — agent harness

Usage:
  min                         open the terminal UI (default)
  min -p "your prompt"        one-shot CLI
  min --prompt "your prompt"  same as -p
  min -i                      interactive CLI REPL
  min --list-sessions         list saved sessions
  min-tui                     terminal UI (explicit)
  min-web                     web UI

Common flags:
  --provider <name>   mock | deepseek | openai | anthropic
  --model <id>        provider model id
  --cwd <dir>         sandbox root
  --session <id>      resume/create session
  --no-tools          disable workspace tools
  -y, --yes           auto-approve tool prompts once
  --auto              full-auto permissions
  -h, --help          show this help

CLI extras (-p / -i): --skills, --session-dir, --max-turns, --context-strategy, …
TUI extras: --theme <id>

For full CLI flag list: min -i -h
`;
}

/** Resolve the TUI entry and run it with the given argv (stdio inherited). */
export function launchTui(argv: string[]): Promise<number> {
  const { command, args } = resolveTuiCommand(argv);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
      shell: false,
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function resolveTuiCommand(argv: string[]): { command: string; args: string[] } {
  const here = dirname(fileURLToPath(import.meta.url));
  const sibling = join(here, "tui.js");
  if (existsSync(sibling)) {
    return { command: process.execPath, args: [sibling, ...argv] };
  }

  const monorepoDist = join(here, "../../tui/dist/tui.js");
  if (existsSync(monorepoDist)) {
    return { command: process.execPath, args: [monorepoDist, ...argv] };
  }

  const monorepoSrc = join(here, "../../tui/src/tui.tsx");
  if (existsSync(monorepoSrc)) {
    // Dev path when `min` is run via tsx from apps/cli/src.
    return {
      command: process.execPath,
      args: ["--import", "tsx", monorepoSrc, ...argv],
    };
  }

  return { command: "min-tui", args: argv };
}
