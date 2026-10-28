export interface TuiArgs {
  help: boolean;
  cwd: string;
  provider?: string;
  model?: string;
  sessionId?: string;
  /** Registered theme id. Defaults to `default`. */
  theme?: string;
  noTools: boolean;
  yes: boolean;
  /** Full-auto permissions (implies yes). */
  auto: boolean;
}

export function parseArgs(argv: string[]): TuiArgs {
  const args: TuiArgs = {
    help: false,
    cwd: process.env.INIT_CWD ?? process.cwd(),
    noTools: false,
    yes: false,
    auto: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") args.help = true;
    else if (a === "--no-tools") args.noTools = true;
    else if (a === "-y" || a === "--yes") args.yes = true;
    else if (a === "--auto") args.auto = true;
    else if (a === "--cwd") args.cwd = argv[++i] ?? args.cwd;
    else if (a === "--provider") args.provider = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--session") args.sessionId = argv[++i];
    else if (a === "--theme") args.theme = argv[++i];
    else if (a.startsWith("-")) throw new Error(`Unknown flag: ${a}`);
  }

  if (envFlagTrue(process.env.MIN_AUTO)) args.auto = true;
  if (args.auto) args.yes = true;
  if (!args.theme && process.env.MIN_THEME?.trim()) args.theme = process.env.MIN_THEME.trim();

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
  --session <id>      resume a saved session
  --theme <id>        theme id from config / registry (MIN_THEME also works)

Config files (later layers win):
  ~/.config/min/config.json
  <cwd>/.min/config.json
  Permissions stay in <cwd>/.min/permissions.json
  --no-tools          disable workspace tools
  -y, --yes           auto-approve tool prompts once
  --auto              full-auto (bash + session grants + root grants)
  -h, --help          show help

Commands:
  /help              show this help
  /session           current session id, title, messages, queue
  /sessions          list saved sessions
  /open <id>         switch to a saved session
  /new               start a fresh session
  /compact           summarize older turns and rewrite stored history
  /reset             clear conversation history
  /queue             show the follow-up queue
  /dense <text>      queue text as a dense-latest supplement
  /exit /quit        quit

Keys:
  Enter              send, or queue while the agent is running
  Shift+Enter        insert a newline
  Alt+Enter / Ctrl+J also insert a newline
  Up/Down            previous line, or input history at the ends
  PageUp/PageDown    scroll the transcript
  Ctrl+O             expand / collapse tool output
  Esc                abort the run while it is busy
  Ctrl+C             abort the run, or quit when idle
  Ctrl+A / Ctrl+E    start / end of line
  Ctrl+W / Ctrl+U    delete the previous word / to the line start
  y / n / a          answer a permission prompt (no answer denies in 2 minutes)

Keybindings can be overridden in config.json under ui.keybindings
(chord → command), e.g. { "enter": "submit", "shift+enter": "newline" }.
`;
}

function envFlagTrue(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
