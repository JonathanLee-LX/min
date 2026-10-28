import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { isPidAlive } from "./ipc.js";
import { clientSocketPath, mindPaths, sessionDir } from "./paths.js";
import type { ClientRecord } from "./protocol.js";
import { MIND_PROTOCOL } from "./version.js";

export async function writeClientRecord(root: string, record: ClientRecord): Promise<void> {
  const dir = sessionDir(root, record.sessionId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "pid"), `${record.pid}\n`, "utf8");
  await writeFile(path.join(dir, "meta.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export async function readClientRecord(
  root: string,
  sessionId: string,
): Promise<ClientRecord | null> {
  try {
    const raw = await readFile(path.join(sessionDir(root, sessionId), "meta.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<ClientRecord>;
    if (
      typeof parsed.sessionId !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.socket !== "string" ||
      typeof parsed.protocol !== "number" ||
      typeof parsed.cwd !== "string"
    ) {
      return null;
    }
    return {
      sessionId: parsed.sessionId,
      pid: parsed.pid,
      socket: parsed.socket,
      protocol: parsed.protocol,
      cwd: parsed.cwd,
      buildVersion: typeof parsed.buildVersion === "string" ? parsed.buildVersion : "",
      provider: parsed.provider,
      autoApprove: Boolean(parsed.autoApprove),
    };
  } catch {
    return null;
  }
}

export async function removeClientRecord(root: string, sessionId: string): Promise<void> {
  await rm(sessionDir(root, sessionId), { recursive: true, force: true });
}

export async function socketConnectable(socketPath: string, ms = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, ms);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export function recordIsLive(record: ClientRecord): boolean {
  return isPidAlive(record.pid);
}

export async function scanRecords(root: string): Promise<ClientRecord[]> {
  const dir = mindPaths(root).sessions;
  let names: string[] = [];
  try {
    await mkdir(dir, { recursive: true });
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: ClientRecord[] = [];
  for (const name of names) {
    const record = await readClientRecord(root, name);
    if (record) out.push(record);
  }
  return out;
}

export type ClaimResult = {
  claimed: ClientRecord[];
  dropped: ClientRecord[];
  skippedProtocol: ClientRecord[];
};

/**
 * Start-up scan. Live + connectable + matching protocol are claimed.
 * Dead or unreachable entries are deleted. Different protocol: leave running,
 * omit from the table.
 */
export async function claimRecords(
  root: string,
  protocol = MIND_PROTOCOL,
): Promise<ClaimResult> {
  const claimed: ClientRecord[] = [];
  const dropped: ClientRecord[] = [];
  const skippedProtocol: ClientRecord[] = [];
  for (const record of await scanRecords(root)) {
    if (record.protocol !== protocol) {
      skippedProtocol.push(record);
      continue;
    }
    const live = recordIsLive(record) && (await socketConnectable(record.socket));
    if (live) {
      claimed.push(record);
    } else {
      dropped.push(record);
      await removeClientRecord(root, record.sessionId);
    }
  }
  return { claimed, dropped, skippedProtocol };
}

export function defaultRecord(opts: {
  root: string;
  sessionId: string;
  cwd: string;
  pid: number;
  protocol: number;
  buildVersion: string;
  provider?: string;
  autoApprove: boolean;
}): ClientRecord {
  return {
    sessionId: opts.sessionId,
    pid: opts.pid,
    socket: clientSocketPath(opts.root, opts.sessionId),
    protocol: opts.protocol,
    cwd: path.resolve(opts.cwd),
    buildVersion: opts.buildVersion,
    provider: opts.provider,
    autoApprove: opts.autoApprove,
  };
}
