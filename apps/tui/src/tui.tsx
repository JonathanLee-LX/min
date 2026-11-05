import { render } from "ink";
import React from "react";
import { helpText, parseArgs } from "./args.js";
import { loadEnvFiles } from "./load-env.js";
import { formatVersionLine } from "./version.js";
import { enterAltScreen } from "./alt-screen.js";
import { disableMouse, enableMouseWheel } from "./mouse-mode.js";

loadEnvFiles();

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
  if (args.version) {
    console.log(formatVersionLine());
    return;
  }

  const leaveAltScreen = enterAltScreen();
  enableMouseWheel();
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    disableMouse();
    leaveAltScreen();
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

  const { App } = await import("./App.js");
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
