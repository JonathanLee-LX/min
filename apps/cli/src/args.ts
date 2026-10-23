export interface CliArgs {
  help: boolean;
  repl: boolean;
  cwd: string;
  provider?: string;
  model?: string;
  skillsDir?: string;
  noTools: boolean;
  /** Approve all permission prompts for this process. */
  yes: boolean;
  /** Force bash permission mode to allow. */
  allowBash: boolean;
  /** Force write_file permission mode to ask. */
  askWrite: boolean;
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
  --cwd <dir>         workspace sandbox root (default: .)
  --skills <dir>      skills directory (optional)
  --no-tools          do not register workspace tools
  -y, --yes           auto-approve permission prompts
  --allow-bash        allow bash without prompting
  --ask-write         confirm write_file (default: allow)
  -i, --repl          interactive mode
  -h, --help          show help

Permissions (defaults):
  read/glob  allow
  write      allow   (use --ask-write to confirm)
  bash       ask     (small allowlist auto-passes; --allow-bash / -y to skip)

Env:
  DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
  DEEPSEEK_API=responses|chat  (DeepSeek protocol, default responses)
`;
}
