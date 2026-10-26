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
  /**
   * Full-auto: allow bash, auto-approve prompts as allow_session,
   * and approve sandbox root grants. Implies yes + allowBash + allowRootGrant.
   */
  auto: boolean;
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
  /** Max model completes (tool-loop turns) per user message. */
  maxTurns: number;
  /**
   * Continuous context projection strategy.
   * Undefined → Runtime default (`hybrid` with tools, `trim` without).
   * On-demand LLM rewrite: REPL `/compact` (not a strategy id).
   */
  contextStrategy?:
    | "trim"
    | "hmt"
    | "tool-offload"
    | "sticky-trim"
    | "hybrid";
  prompt?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    repl: false,
    cwd: process.env.INIT_CWD ?? process.cwd(),
    noTools: false,
    yes: false,
    auto: false,
    allowBash: false,
    askWrite: false,
    allowRootGrant: false,
    addRoots: [],
    noSessionStore: false,
    listSessions: false,
    maxContextTokens: Number(process.env.MIN_MAX_CONTEXT_TOKENS ?? 32_000),
    maxTurns: Number(process.env.MIN_MAX_TURNS ?? 40),
    contextStrategy: parseStrategy(process.env.MIN_CONTEXT_STRATEGY),
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
    } else if (a === "--auto") {
      args.auto = true;
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
    } else if (a === "--max-turns") {
      const raw = argv[++i];
      const n = Number(raw);
      if (!raw || !Number.isFinite(n) || n < 1) {
        throw new Error("--max-turns must be a positive integer");
      }
      args.maxTurns = Math.floor(n);
    } else if (a === "--context-strategy") {
      const raw = argv[++i];
      const parsed = parseStrategy(raw);
      if (!parsed) {
        throw new Error(
          "--context-strategy must be trim | hmt | tool-offload | sticky-trim | hybrid",
        );
      }
      args.contextStrategy = parsed;
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

  if (envFlagTrue(process.env.MIN_AUTO)) {
    args.auto = true;
  }
  if (args.auto) {
    args.yes = true;
    args.allowBash = true;
    args.allowRootGrant = true;
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
  -y, --yes           auto-approve tool prompts once (NOT root expansion)
  --auto              full-auto: bash allow + session grants + root grants
  --allow-bash        allow bash without prompting
  --ask-write         confirm write_file (default: allow)
  --allow-root-grant  allow non-interactive approval of sandbox root grants
  --session <id>      resume/create conversation session id
  --session-dir <dir> session store directory (default: <cwd>/.min/sessions)
  --no-session-store  keep conversation only in memory
  --list-sessions     list sessions in --session-dir and exit
  --max-context-tokens <n>  model view budget (default: 32000)
  --max-user-turns <n>      keep at most N trailing user turns in the view
  --max-turns <n>           max model completes per user message (default: 40)
  --context-strategy <id>   trim|hmt|tool-offload|sticky-trim|hybrid
  -i, --repl          interactive mode
  -h, --help          show help

During a run:
  Ctrl+C              abort the current turn (REPL stays open)

REPL commands:
  /help  /session  /compact  /reset  /queue  /dense  /exit
  (lines typed during a run are queued; drained after the agent pass)

Context:
  Full history is stored; the model sees a projected view (pluggable strategy).
  Default with tools: hybrid. Without tools (or --no-tools): trim.
  trim         drop oldest turns (eval baseline)
  sticky-trim  freeze leading turns, trim after them (cache-friendlier)
  tool-offload fold large tool_results into stash + recall_context
  hmt          head/middle/tail fold + stash + recall_context
  hybrid       sticky head + aggressive middle tool offload + recall (default w/ tools)
  /compact     on-demand LLM summary that rewrites stored history (not a strategy)
  Assistant text streams as it arrives; tool traces print on stderr-friendly lines.

Env:
  DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
  MIN_AUTO=1          same as --auto
  MIN_PROVIDER_MODULE extra module(s) that call registerProvider
  MIN_MAX_CONTEXT_TOKENS
  MIN_MAX_TURNS
  MIN_CONTEXT_STRATEGY=trim|hmt|tool-offload|sticky-trim|hybrid
`;
}

function envFlagTrue(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}


function parseStrategy(
  raw: string | undefined,
): CliArgs["contextStrategy"] | undefined {
  if (!raw) return undefined;
  if (
    raw === "trim" ||
    raw === "hmt" ||
    raw === "tool-offload" ||
    raw === "sticky-trim" ||
    raw === "hybrid"
  ) {
    return raw;
  }
  return undefined;
}
