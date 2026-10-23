import { render } from "ink";
import React from "react";
import { helpText, parseArgs } from "./args.js";
import { App } from "./App.js";
import { loadEnvFiles } from "./load-env.js";

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

  render(<App args={args} />);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
