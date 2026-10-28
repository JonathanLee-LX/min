import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureMind, mindCreate, mindDestroy, mindList, mindLookup, openLease } from "./connect.js";
import { startMindDaemon } from "./daemon.js";
import { isPidAlive, sleep } from "./ipc.js";
import { clientSocketPath } from "./paths.js";
import type { ClientRecord } from "./protocol.js";
import { readClientRecord, writeClientRecord } from "./registry.js";
import { MIND_PROTOCOL, mindBuildVersion } from "./version.js";

const temps: string[] = [];
const kids: Array<{ pid?: number; kill: () => void }> = [];

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "min-mind-d-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  for (const child of kids.splice(0)) {
    try {
      if (child.pid) process.kill(child.pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function startStubClient(opts: {
  root: string;
  sessionId: string;
  cwd: string;
  protocol?: number;
}): { pid: number; socket: string } {
  const socket = clientSocketPath(opts.root, opts.sessionId);
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
const net = require("net");
const fs = require("fs");
const path = require("path");
const sock = ${JSON.stringify(socket)};
fs.mkdirSync(path.dirname(sock), { recursive: true });
try { fs.unlinkSync(sock); } catch {}
const server = net.createServer();
server.listen(sock, () => {
  const rec = {
    sessionId: ${JSON.stringify(opts.sessionId)},
    pid: process.pid,
    socket: sock,
    protocol: ${opts.protocol ?? MIND_PROTOCOL},
    cwd: ${JSON.stringify(path.resolve(opts.cwd))},
    buildVersion: ${JSON.stringify(mindBuildVersion())},
    autoApprove: false
  };
  fs.writeFileSync(path.join(path.dirname(sock), "meta.json"), JSON.stringify(rec, null, 2));
  fs.writeFileSync(path.join(path.dirname(sock), "pid"), String(process.pid));
});
setInterval(() => {}, 60_000);
process.on("SIGTERM", () => { try { fs.rmSync(path.dirname(sock), { recursive: true, force: true }); } catch {} process.exit(0); });
`,
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  kids.push({ pid: child.pid, kill: () => child.pid && process.kill(child.pid, "SIGKILL") });
  if (!child.pid) throw new Error("stub client failed to start");
  return { pid: child.pid, socket };
}

async function waitForRecord(root: string, sessionId: string, ms = 5_000): Promise<ClientRecord> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const rec = await readClientRecord(root, sessionId);
    if (rec) return rec;
    await sleep(30);
  }
  throw new Error(`record ${sessionId} did not appear`);
}

describe("mind daemon", () => {
  it("creates, looks up, lists, and destroys a client process", async () => {
    const root = await tmpRoot();
    const daemon = await startMindDaemon({
      root,
      drainMs: 50,
      destroyMs: 1_000,
      createMs: 5_000,
      spawnClient: (opts) => startStubClient(opts),
    });

    const created = await mindCreate({ op: "create", cwd: root, sessionId: "ses_one" }, root);
    expect(created.sessionId).toBe("ses_one");
    expect(created.address).toBe(clientSocketPath(root, "ses_one"));

    const found = await mindLookup("ses_one", root);
    expect(found?.address).toBe(created.address);

    const again = await mindCreate({ op: "create", cwd: root, sessionId: "ses_one" }, root);
    expect(again.address).toBe(created.address);

    const listed = await mindList(root, root);
    expect(listed.live.map((l) => l.sessionId)).toContain("ses_one");

    await mindDestroy("ses_one", root);
    expect(await mindLookup("ses_one", root)).toBeNull();
    await daemon.close();
  });

  it("drains a client after the last lease expires", async () => {
    const root = await tmpRoot();
    const daemon = await startMindDaemon({
      root,
      drainMs: 80,
      destroyMs: 1_000,
      createMs: 5_000,
      spawnClient: (opts) => startStubClient(opts),
    });
    const created = await mindCreate({ op: "create", cwd: root, sessionId: "ses_lease" }, root);
    const rec = await waitForRecord(root, "ses_lease");
    const lease = await openLease(created.sessionId, root);
    expect(isPidAlive(rec.pid)).toBe(true);
    lease.release();
    const deadline = Date.now() + 3_000;
    while (isPidAlive(rec.pid) && Date.now() < deadline) {
      await sleep(40);
    }
    expect(isPidAlive(rec.pid)).toBe(false);
    expect(await mindLookup("ses_lease", root)).toBeNull();
    await daemon.close();
  });

  it("keeps clients running when mind itself closes", async () => {
    const root = await tmpRoot();
    const daemon = await startMindDaemon({
      root,
      drainMs: 5_000,
      destroyMs: 1_000,
      createMs: 5_000,
      spawnClient: (opts) => startStubClient(opts),
    });
    await mindCreate({ op: "create", cwd: root, sessionId: "ses_keep" }, root);
    const rec = await waitForRecord(root, "ses_keep");
    await daemon.close();
    expect(isPidAlive(rec.pid)).toBe(true);
    expect(await readClientRecord(root, "ses_keep")).not.toBeNull();
  });

  it("lookup is empty after SIGKILL, and create of the same id does not require a live process", async () => {
    const root = await tmpRoot();
    const daemon = await startMindDaemon({
      root,
      drainMs: 50,
      destroyMs: 1_000,
      createMs: 5_000,
      spawnClient: (opts) => startStubClient(opts),
    });
    await mindCreate({ op: "create", cwd: root, sessionId: "ses_kill" }, root);
    const rec = await waitForRecord(root, "ses_kill");
    process.kill(rec.pid, "SIGKILL");
    const deadline = Date.now() + 2_000;
    while (isPidAlive(rec.pid) && Date.now() < deadline) await sleep(30);
    expect(await mindLookup("ses_kill", root)).toBeNull();
    const created = await mindCreate({ op: "create", cwd: root, sessionId: "ses_kill" }, root);
    expect(created.sessionId).toBe("ses_kill");
    await daemon.close();
  });
});

describe("ensureMind", () => {
  it("is a no-op when a daemon is already serving the same build", async () => {
    const root = await tmpRoot();
    const daemon = await startMindDaemon({ root, spawnClient: (opts) => startStubClient(opts) });
    const conn = await ensureMind(root);
    expect(conn.hello.protocol).toBe(MIND_PROTOCOL);
    expect(conn.hello.buildVersion).toBe(mindBuildVersion());
    conn.close();
    await daemon.close();
  });
});
