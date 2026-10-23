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
  /** Resume or create this conversation session id. */
  sessionId?: string;
  /** Directory for FsStore (default: <cwd>/.min/sessions). */
  sessionDir?: string;
  /** Do not persist the conversation session. */
  noSessionStore: boolean;
  /** List saved sessions and exit. */
  listSessions: boolean;
  /** Max context tokens for model view (system+tools+messages). */
  maxContextTokens: number;
  /** Max trailing user-turns kept in the model view. */
  maxUserTurns?: number;
  prompt?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    repl: false,
    cwd: process.env.INIT_CWD ?? process.cwd(),
    noTools: false,
    yes: false,
    allowBash: false,
    askWrite: false,
    allowRootGrant: false,
    addRoots: [],
    noSessionStore: false,
    listSessions: false,
    maxContextTokens: Number(process.env.MIN_MAX_CONTEXT_TOKENS ?? 32_000),
  };

  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
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
    } else if (a === "--no-session-store") {
      args.noSessionStore = true;
    } else if (a === "--list-sessions") {
      args.listSessions = true;
    } else if (a === "--add-root") {
      const dir = argv[++i];
      if (!dir) throw new Error("--add-root requires a directory");
      args.addRoots.push(dir);
    } else if (a === "--session") {
      args.sessionId = argv[++i];
      if (!args.sessionId) throw new Error("--session requires an id");
    } else if (a === "--session-dir") {
      args.sessionDir = argv[++i];
      if (!args.sessionDir) throw new Error("--session-dir requires a path");
    } else if (a === "--max-context-tokens") {
      const raw = argv[++i];
      const n = Number(raw);
      if (!raw || !Number.isFinite(n) || n < 1024) {
        throw new Error("--max-context-tokens must be a number >= 1024");
      }
      args.maxContextTokens = n;
    } else if (a === "--max-user-turns") {
      const raw = argv[++i];
      const n = Number(raw);
      if (!raw || !Number.isFinite(n) || n < 1) {
        throw new Error("--max-user-turns must be a positive integer");
      }
      args.maxUserTurns = n;
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
  min --list-sessions             list saved conversation sessions

Options:
  --provider <name>   mock | deepseek | openai | anthropic
  --model <id>        provider model id
  --cwd <dir>         primary sandbox root (default: .)
  --add-root <dir>    seed an extra sandbox session root (repeatable)
  --skills <dir>      skills directory (optional)
  --no-tools          do not register workspace tools
  -y, --yes           auto-approve tool prompts (NOT root expansion)
  --allow-bash        allow bash without prompting
  --ask-write         confirm write_file (default: allow)
  --allow-root-grant  allow non-interactive approval of sandbox root grants
  --session <id>      resume/create conversation session id
  --session-dir <dir> session store directory (default: <cwd>/.min/sessions)
  --no-session-store  keep conversation only in memory
  --list-sessions     list sessions in --session-dir and exit
  --max-context-tokens <n>  model view budget (default: 32000)
  --max-user-turns <n>      keep at most N trailing user turns in the view
  -i, --repl          interactive mode
  -h, --help          show help

Context:
  Full history is stored in the session; only a budgeted suffix is sent to the model.
  Oldest user-turns are dropped from the model view when over budget (cost/window).

Env:
  DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
  MIN_MAX_CONTEXT_TOKENS
`;
}
