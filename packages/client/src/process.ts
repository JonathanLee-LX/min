import { createAutoPermissionApprover } from "./auto-permission.js";
import { createClient, getClientHost } from "./client.js";
import { serveClient } from "./wire.js";
import { CLIENT_PROTOCOL } from "./protocol.js";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ModelProvider } from "@min-agent/core";
import {
  loadProviderExtensions,
  resolveProvider,
  type RuntimeOptions,
} from "@min-agent/runtime";

interface ClientLaunch {
  sessionId: string;
  cwd: string;
  provider?: string;
  model?: string;
  autoApprove: boolean;
  approveMode?: "yes" | "auto";
  allowRootGrant?: boolean;
  persistPermissionGrants?: boolean;
  noTools?: boolean;
  allowBash?: boolean;
  askWrite?: boolean;
  skillsDir?: string;
  addRoots?: string[];
  maxContextTokens?: number;
  maxUserTurns?: number;
  maxTurns?: number;
  contextStrategy?: RuntimeOptions["contextStrategy"];
  sessionDir?: string;
  noSessionStore?: boolean;
  socketPath: string;
  registryDir: string;
  buildVersion: string;
  protocol: number;
}

/**
 * One session process. Mind spawns it and then only signals SIGTERM.
 * The frontend talks to the socket this process binds — not through mind.
 */
async function main(): Promise<void> {
  const launch = readLaunch(process.argv.slice(2));
  process.chdir(launch.cwd);
  loadEnvFiles();
  await loadProviderExtensions();

  let provider = resolveProvider({
    provider: launch.provider,
    model: launch.model,
  });
  provider = maybeHoldProvider(provider);

  const auto =
    launch.autoApprove === true
      ? createAutoPermissionApprover({
          mode: launch.approveMode ?? "yes",
          allowRootGrant: launch.allowRootGrant === true,
        })
      : undefined;

  const client = await createClient({
    cwd: launch.cwd,
    provider,
    sessionId: launch.sessionId,
    sessionDir: launch.sessionDir,
    noSessionStore: launch.noSessionStore,
    noTools: launch.noTools,
    skillsDir: launch.skillsDir,
    addRoots: launch.addRoots,
    askWrite: launch.askWrite,
    allowBash: launch.allowBash || launch.autoApprove === true,
    maxContextTokens: launch.maxContextTokens,
    maxUserTurns: launch.maxUserTurns,
    maxTurns: launch.maxTurns,
    contextStrategy: launch.contextStrategy,
    applyRootGrant: true,
    persistPermissionGrants: launch.persistPermissionGrants !== false,
    autoApprovePermission: auto,
  });

  const server = await serveClient({
    client,
    socketPath: launch.socketPath,
    buildVersion: launch.buildVersion,
  });
  await writeRecord(launch);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      try {
        await getClientHost(client).shutdown();
      } catch {
        // Persist failure still exits.
      }
      try {
        await server.close();
      } catch {
        // Socket cleanup is best-effort.
      }
      await rm(launch.registryDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
      process.exit(0);
    })();
  };

  process.on("SIGTERM", stop);
}

function readLaunch(argv: string[]): ClientLaunch {
  let file = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--launch") file = argv[++i] ?? "";
  }
  if (!file) throw new Error("client process requires --launch <file>");
  const launch = JSON.parse(readFileSync(file, "utf8")) as ClientLaunch;
  if (!launch.sessionId || !launch.socketPath || !launch.registryDir || !launch.cwd) {
    throw new Error("client launch is missing sessionId, cwd, socket, or registry");
  }
  if (launch.protocol !== CLIENT_PROTOCOL) {
    throw new Error(
      `client launch protocol ${launch.protocol} != ${CLIENT_PROTOCOL}`,
    );
  }
  return launch;
}

async function writeRecord(launch: ClientLaunch): Promise<void> {
  await mkdir(launch.registryDir, { recursive: true });
  const record = {
    pid: process.pid,
    socketPath: launch.socketPath,
    protocol: CLIENT_PROTOCOL,
    cwd: launch.cwd,
    buildVersion: launch.buildVersion,
  };
  const dest = path.join(launch.registryDir, "record.json");
  const tmp = `${dest}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(record), "utf8");
  await rename(tmp, dest);
}

/**
 * Test-only stall. `MIN_CLIENT_TEST_HOLD_AFTER=N` lets the first N provider
 * calls finish and then waits inside the next stream so shutdown / SIGKILL
 * tests can observe an in-flight turn. Unset in normal runs.
 */
function maybeHoldProvider(provider: ModelProvider): ModelProvider {
  const raw = process.env.MIN_CLIENT_TEST_HOLD_AFTER;
  if (raw === undefined || raw === "") return provider;
  const after = Number(raw);
  if (!Number.isFinite(after) || after < 0) return provider;
  let calls = 0;
  const stream = provider.stream?.bind(provider);
  return {
    id: provider.id,
    complete: (req) => provider.complete(req),
    async *stream(req) {
      calls += 1;
      if (calls > after) {
        yield { type: "thinking_delta", text: "THOUGHT" };
        yield { type: "text_delta", text: "PARTIAL" };
        await new Promise<void>((_resolve, reject) => {
          const fail = () => reject(new DOMException("aborted", "AbortError"));
          if (req.signal?.aborted) {
            fail();
            return;
          }
          const timer = setInterval(() => {
            if (req.signal?.aborted) {
              clearInterval(timer);
              fail();
            }
          }, 15);
          req.signal?.addEventListener(
            "abort",
            () => {
              clearInterval(timer);
              fail();
            },
            { once: true },
          );
        });
        return;
      }
      if (stream) {
        yield* stream(req);
        return;
      }
      const result = await provider.complete(req);
      yield { type: "done", result };
    },
  };
}

function loadEnvFiles(): void {
  const roots = new Set<string>([process.cwd()]);
  if (process.env.INIT_CWD) roots.add(process.env.INIT_CWD);
  const files: string[] = [];
  if (process.env.HOME) {
    files.push(path.join(process.env.HOME, ".config", "min", ".env"));
  }
  for (const root of roots) {
    let dir = path.resolve(root);
    for (let i = 0; i < 5; i++) {
      files.push(path.join(dir, ".env"));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] !== undefined) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("process.ts") || entry.endsWith("process.js")) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
