export interface CliArgs {
  help: boolean;
  repl: boolean;
  cwd: string;
  provider?: string;
  model?: string;
  skillsDir?: string;
  noTools: boolean;
  /** Approve tool permission prompts (does NOT auto-expand sandbox roots). */
  yes: boolean;
  /** Force bash permission mode to allow. */
  allowBash: boolean;
  /** Force write_file permission mode to ask. */
  askWrite: boolean;
  /** Allow -y / non-interactive approval of session root grants. */
  allowRootGrant: boolean;
  /** Extra roots seeded at startup. */
  addRoots: string[];
  prompt?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    repl: false,
    // pnpm/npm set INIT_CWD to the caller's directory
    cwd: process.env.INIT_CWD ?? process.cwd(),
    noTools: false,
    yes: false,
    allowBash: false,
    askWrite: false,
    allowRootGrant: false,
    addRoots: [],
  };

  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      continue;
    }
    if (a === "-h" || a === "--help") {
      args.help = true;
    } else if (a === "-i" || a === "--repl") {
      args.repl = true;
    } else if (a === "--no-tools") {
      args.noTools = true;
    } else if (a === "-y" || a === "--yes") {
      args.yes = true;
    } else if (a === "--allow-bash") {
      args.allowBash = true;
    } else if (a === "--ask-write") {
      args.askWrite = true;
    } else if (a === "--allow-root-grant") {
      args.allowRootGrant = true;
    } else if (a === "--add-root") {
      const dir = argv[++i];
      if (!dir) throw new Error("--add-root requires a directory");
      args.addRoots.push(dir);
    } else if (a === "--cwd") {
      args.cwd = argv[++i] ?? args.cwd;
    } else if (a === "--provider") {
      args.provider = argv[++i];
    } else if (a === "--model") {
      args.model = argv[++i];
    } else if (a === "--skills") {
      args.skillsDir = argv[++i];
    } else if (a.startsWith("-")) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }

  if (positional.length) {
    args.prompt = positional.join(" ");
  }

  return args;
}

export function helpText(): string {
  return `min — minimal agent CLI

Usage:
  min [options] "your prompt"     one-shot
  min -i                          interactive REPL
  min -i "your prompt"            REPL after an initial turn

Options:
  --provider <name>   mock | deepseek | openai | anthropic
                      (default: DEEPSEEK_API_KEY → deepseek, else mock)
  --model <id>        provider model id
  --cwd <dir>         primary sandbox root (default: .)
  --add-root <dir>    seed an extra session root (repeatable)
  --skills <dir>      skills directory (optional)
  --no-tools          do not register workspace tools
  -y, --yes           auto-approve tool prompts (NOT root expansion)
  --allow-bash        allow bash without prompting
  --ask-write         confirm write_file (default: allow)
  --allow-root-grant  allow non-interactive / -y approval of session root grants
  -i, --repl          interactive mode
  -h, --help          show help

Permissions (defaults):
  read/glob  allow (inside roots)
  write      allow (inside roots; --ask-write to confirm)
  bash       ask   (small allowlist auto-passes)
  outside root → ask to add a tight session root (y/a both grant for session)

Env:
  DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
  DEEPSEEK_API=responses|chat  (DeepSeek protocol, default responses)
`;
}
