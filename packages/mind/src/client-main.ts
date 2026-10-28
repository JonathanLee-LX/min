import { createAutoPermissionApprover, createClient } from "@min-agent/client";
import { loadProviderExtensions, resolveProvider } from "@min-agent/runtime";
import { listenClientProcess } from "./client-server.js";
import { loadEnvFiles } from "./load-env.js";
import { mindRoot } from "./paths.js";
import type { PermissionMode } from "./protocol.js";

interface ClientArgs {
  root: string;
  sessionId: string;
  cwd: string;
  provider?: string;
  model?: string;
  permissionMode: PermissionMode;
  noTools: boolean;
}

function parseArgs(argv: string[]): ClientArgs {
  const args: ClientArgs = {
    root: mindRoot(),
    sessionId: "",
    cwd: process.cwd(),
    permissionMode: "ask",
    noTools: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--mind-root") args.root = argv[++i] ?? args.root;
    else if (a === "--session-id") args.sessionId = argv[++i] ?? "";
    else if (a === "--cwd") args.cwd = argv[++i] ?? args.cwd;
    else if (a === "--provider") args.provider = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--permission-mode") {
      const mode = argv[++i];
      if (mode === "yes" || mode === "auto" || mode === "ask") args.permissionMode = mode;
    } else if (a === "--no-tools") args.noTools = true;
  }
  if (!args.sessionId.trim()) throw new Error("--session-id is required");
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  process.chdir(args.cwd);
  loadEnvFiles(args.cwd);
  await loadProviderExtensions();

  const auto =
    args.permissionMode === "auto"
      ? createAutoPermissionApprover({ mode: "auto", allowRootGrant: true })
      : args.permissionMode === "yes"
        ? createAutoPermissionApprover({ mode: "yes" })
        : undefined;

  const client = await createClient({
    cwd: args.cwd,
    provider: resolveProvider({
      provider: args.provider,
      model: args.model,
    }),
    sessionId: args.sessionId,
    noTools: args.noTools,
    allowBash: args.permissionMode !== "ask",
    applyRootGrant: true,
    persistPermissionGrants: args.permissionMode !== "auto",
    autoApprovePermission: auto,
  });

  const server = await listenClientProcess({
    client,
    root: args.root,
    sessionId: client.getSession().id,
    cwd: args.cwd,
    provider: client.getStatus().provider,
    autoApprove: args.permissionMode !== "ask",
  });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void server.shutdown().then(
      () => process.exit(0),
      () => process.exit(0),
    );
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
