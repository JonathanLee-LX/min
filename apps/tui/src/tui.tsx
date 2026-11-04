import { render } from "ink";
import React from "react";
import { helpText, parseArgs } from "./args.js";
import { App } from "./App.js";
import { loadEnvFiles } from "./load-env.js";

loadEnvFiles();

/**
 * Button and drag reporting would swallow the pointer, so a drag could not
 * select text. Release those modes and leave selection to the terminal.
 * The transcript still scrolls from the keyboard.
 */
const MOUSE_RELEASE = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";

async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    console.log(helpText());
    return;
  }

  if (process.stdout.isTTY) {
    process.stdout.write(MOUSE_RELEASE);
  }
  const cleanup = () => {
    if (process.stdout.isTTY) {
      process.stdout.write(MOUSE_RELEASE);
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  const app = render(<App args={args} />, { exitOnCtrlC: false });
  try {
    await app.waitUntilExit();
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
