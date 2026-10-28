import { spawn, type ChildProcess } from "node:child_process";
import { resolveSiblingEntry } from "./entries.js";
import type { PermissionMode } from "./protocol.js";

export interface SpawnClientOptions {
  root: string;
  sessionId: string;
  cwd: string;
  provider?: string;
  model?: string;
  permissionMode?: PermissionMode;
  autoApprove?: boolean;
  noTools?: boolean;
  env?: NodeJS.ProcessEnv;
}

export function permissionModeOf(opts: {
  autoApprove?: boolean;
  permissionMode?: PermissionMode;
}): PermissionMode {
  if (opts.permissionMode) return opts.permissionMode;
  return opts.autoApprove ? "yes" : "ask";
}

export function spawnClientProcess(opts: SpawnClientOptions): ChildProcess {
  const { command, args } = resolveSiblingEntry("client-main");
  const mode = permissionModeOf(opts);
  const child = spawn(
    command,
    [
      ...args,
      "--mind-root",
      opts.root,
      "--session-id",
      opts.sessionId,
      "--cwd",
      opts.cwd,
      "--permission-mode",
      mode,
      ...(opts.provider ? ["--provider", opts.provider] : []),
      ...(opts.model ? ["--model", opts.model] : []),
      ...(opts.noTools ? ["--no-tools"] : []),
    ],
    {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      detached: true,
      stdio: "ignore",
    },
  );
  return child;
}

export function spawnMindDaemon(opts: { root: string; env?: NodeJS.ProcessEnv }): ChildProcess {
  const { command, args } = resolveSiblingEntry("mind-main");
  const child = spawn(command, [...args, "--root", opts.root], {
    env: { ...process.env, ...opts.env, MIND_HOME: opts.root },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child;
}
