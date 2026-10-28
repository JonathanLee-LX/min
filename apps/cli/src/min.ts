/**
 * `min` entry: default opens the TUI; `-p` / `-i` / `--list-sessions` use the CLI.
 */
import { helpText, parseArgs } from "./args.js";
import { combinedHelpText, launchTui, resolveMinMode } from "./dispatch.js";
import { loadEnvFiles } from "./load-env.js";
import { runCli } from "./cli.js";

loadEnvFiles();

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let mode;
  try {
    mode = resolveMinMode(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  if (mode === "help") {
    console.log(combinedHelpText());
    return;
  }

  if (mode === "tui") {
    try {
      process.exitCode = await launchTui(argv);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      console.error("hint: install/link min-tui, or run from a built monorepo");
      process.exitCode = 1;
    }
    return;
  }

  // CLI mode (-p / -i / --list-sessions). Honor -h as CLI help.
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(helpText());
    return;
  }
  await runCli(args);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
