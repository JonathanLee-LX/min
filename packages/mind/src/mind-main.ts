import { startMindDaemon } from "./daemon.js";
import { mindRoot } from "./paths.js";

function parseRoot(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") return argv[i + 1] ?? mindRoot();
    if (argv[i]?.startsWith("--root=")) return argv[i]!.slice("--root=".length);
  }
  return mindRoot();
}

async function main(): Promise<void> {
  const root = parseRoot(process.argv.slice(2));
  process.env.MIND_HOME = root;
  try {
    await startMindDaemon({ root, installSignals: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already running/i.test(message)) {
      process.exit(0);
    }
    console.error(message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
