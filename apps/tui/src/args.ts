export interface TuiArgs {
  help: boolean;
  cwd: string;
  provider?: string;
  model?: string;
  sessionId?: string;
  noTools: boolean;
  yes: boolean;
}

export function parseArgs(argv: string[]): TuiArgs {
  const args: TuiArgs = {
    help: false,
    cwd: process.env.INIT_CWD ?? process.cwd(),
    noTools: false,
    yes: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") args.help = true;
    else if (a === "--no-tools") args.noTools = true;
    else if (a === "-y" || a === "--yes") args.yes = true;
    else if (a === "--cwd") args.cwd = argv[++i] ?? args.cwd;
    else if (a === "--provider") args.provider = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--session") args.sessionId = argv[++i];
    else if (a.startsWith("-")) throw new Error(`Unknown flag: ${a}`);
  }
  return args;
}

export function helpText(): string {
  return `min-tui — terminal UI for min

Usage:
  min-tui [options]

Options:
  --provider <name>   mock | deepseek | openai | anthropic
  --model <id>        provider model id
  --cwd <dir>         sandbox root
  --session <id>      session id
  --no-tools          disable workspace tools
  -y, --yes           auto-approve tool prompts
  -h, --help          show help

Keys:
  Enter               send message
  Ctrl+C              quit (or interrupt when supported)
  /exit               quit
  /session            show session info
  /reset              clear history
`;
}
