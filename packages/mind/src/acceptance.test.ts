import { connectRemote, type ClientEvent } from "@min-agent/client";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../client",
);
const clientEntry = existsSync(path.join(clientRoot, "dist/process.js"))
  ? path.join(clientRoot, "dist/process.js")
  : path.join(clientRoot, "src/process.ts");
import { afterEach, describe, expect, it } from "vitest";
import { ensureMind, type Mind } from "./api.js";
import { mindPidPath } from "./paths.js";
import { PROTOCOL } from "./protocol.js";
import { pidAlive } from "./registry.js";

const clients: number[] = [];
const homes: string[] = [];
const minds: Mind[] = [];

afterEach(async () => {
  for (const mind of minds.splice(0)) {
    try {
      await mind.stop();
    } catch {
      mind.close();
    }
  }
  for (const pid of clients.splice(0)) {
    if (pidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
  for (const home of homes.splice(0)) {
    await rm(home, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("mind and session processes", () => {
  it("fans one session out to two frontends", async () => {
    const { mind, cwd } = await boot();
    const address = await mind.create({
      cwd,
      provider: "mock",
      autoApprove: true,
      noTools: true,
    });
    clients.push(address.pid);
    const leaseA = await mind.lease(address.sessionId);
    const leaseB = await mind.lease(address.sessionId);
    const left = await connectRemote(address.socketPath);
    const right = await connectRemote(address.socketPath);
    const leftEvents: ClientEvent[] = [];
    const rightEvents: ClientEvent[] = [];
    left.subscribe((event) => leftEvents.push(event));
    right.subscribe((event) => rightEvents.push(event));
    await left.send("hello");
    expect(leftEvents.some((event) => event.type === "assistant_done")).toBe(true);
    expect(rightEvents.some((event) => event.type === "assistant_done")).toBe(true);
    left.close();
    right.close();
    leaseA.close();
    leaseB.close();
  });

  it("keeps the previous session running until its own leases drain", async () => {
    const { mind, cwd } = await boot({ holdAfter: "0" });
    const first = await mind.create({
      cwd,
      provider: "mock",
      autoApprove: true,
      noTools: true,
      sessionId: "ses_first",
    });
    clients.push(first.pid);
    const lease = await mind.lease(first.sessionId);
    const remote = await connectRemote(first.socketPath);
    const events: ClientEvent[] = [];
    remote.subscribe((event) => events.push(event));
    const running = remote.send("stay");
    await waitFor(() => events.some((event) => event.type === "assistant_delta"));

    const second = await mind.create({
      cwd,
      provider: "mock",
      autoApprove: true,
      noTools: true,
      sessionId: "ses_second",
    });
    clients.push(second.pid);
    const secondLease = await mind.lease(second.sessionId);
    expect(pidAlive(first.pid)).toBe(true);
    expect(second.pid).not.toBe(first.pid);

    remote.close();
    lease.close();
    await running.catch(() => undefined);
    await waitFor(() => !pidAlive(first.pid), 4_000);
    expect(pidAlive(second.pid)).toBe(true);
    secondLease.close();
  });

  it("persists the partial turn after the last frontend drains", async () => {
    const { mind, cwd } = await boot({ holdAfter: "0" });
    const address = await mind.create({
      cwd,
      provider: "mock",
      autoApprove: true,
      noTools: true,
      sessionId: "ses_partial",
    });
    clients.push(address.pid);
    const lease = await mind.lease(address.sessionId);
    const remote = await connectRemote(address.socketPath);
    const events: ClientEvent[] = [];
    remote.subscribe((event) => events.push(event));
    const running = remote.send("please note");
    await waitFor(() =>
      events.some(
        (event) => event.type === "assistant_delta" && event.text.includes("PARTIAL"),
      ),
    );
    remote.close();
    lease.close();
    await running.catch(() => undefined);
    await waitFor(() => !pidAlive(address.pid), 4_000);
    const raw = await readFile(
      path.join(cwd, ".min", "sessions", "ses_partial.json"),
      "utf8",
    );
    expect(raw).toContain("please note");
    expect(raw).toContain("PARTIAL");
    expect(raw).not.toContain("THOUGHT");
  });

  it("lets a new mind claim clients after the old mind is signaled", async () => {
    const { mind, cwd, home } = await boot({ version: "0.0.1" });
    const address = await mind.create({
      cwd,
      provider: "mock",
      autoApprove: true,
      noTools: true,
      sessionId: "ses_claim",
    });
    clients.push(address.pid);
    const firstPid = JSON.parse(await readFile(mindPidPath(home), "utf8")) as {
      pid: number;
    };
    await mind.stop();
    expect(pidAlive(address.pid)).toBe(true);
    expect(pidAlive(firstPid.pid)).toBe(false);

    const next = await ensureMind({
      home,
      clientEntry,
      buildVersion: "0.0.1",
    });
    minds.push(next);
    const found = await next.lookup("ses_claim");
    expect(found?.pid).toBe(address.pid);
    expect(found?.socketPath).toBe(address.socketPath);
    const again = await next.create({
      cwd: "/somewhere/else",
      provider: "other",
      autoApprove: false,
      sessionId: "ses_claim",
    });
    expect(again.pid).toBe(address.pid);
  });

  it("reloads the last good file after SIGKILL and does not resume the turn", async () => {
    const { mind, cwd } = await boot({ holdAfter: "2" });
    const address = await mind.create({
      cwd,
      provider: "mock",
      autoApprove: true,
      noTools: true,
      sessionId: "ses_kill",
    });
    clients.push(address.pid);
    const lease = await mind.lease(address.sessionId);
    const remote = await connectRemote(address.socketPath);
    await remote.send("first turn");
    const saved = await readFile(
      path.join(cwd, ".min", "sessions", "ses_kill.json"),
      "utf8",
    );
    expect(saved).toContain("first turn");
    expect(saved).not.toContain("PARTIAL");

    const events: ClientEvent[] = [];
    remote.subscribe((event) => events.push(event));
    const running = remote.send("second turn");
    await waitFor(() =>
      events.some(
        (event) => event.type === "assistant_delta" && event.text.includes("PARTIAL"),
      ),
    );
    process.kill(address.pid, "SIGKILL");
    await running.catch(() => undefined);
    await waitFor(() => !pidAlive(address.pid));
    remote.close();
    lease.close();

    expect(await mind.lookup("ses_kill")).toBeNull();
    const restored = await mind.create({
      cwd,
      provider: "mock",
      autoApprove: true,
      noTools: true,
      sessionId: "ses_kill",
    });
    clients.push(restored.pid);
    expect(restored.pid).not.toBe(address.pid);
    const again = await connectRemote(restored.socketPath);
    expect(again.getStatus().status).toBe("idle");
    const body = JSON.stringify(again.getSession().messages);
    expect(body).toContain("first turn");
    expect(body).not.toContain("PARTIAL");
    expect(body).not.toContain("second turn");
    again.close();
  });

  it("replaces mind on build change without stopping live clients", async () => {
    const { mind, cwd, home } = await boot({ version: "0.0.1" });
    const address = await mind.create({
      cwd,
      provider: "mock",
      autoApprove: true,
      noTools: true,
      sessionId: "ses_swap",
    });
    clients.push(address.pid);
    const replaced = await ensureMind({
      home,
      clientEntry,
      buildVersion: "0.0.2",
    });
    minds.push(replaced);
    expect(replaced.buildVersion).toBe("0.0.2");
    expect(pidAlive(address.pid)).toBe(true);
    const found = await replaced.lookup("ses_swap");
    expect(found?.pid).toBe(address.pid);
    expect(found?.buildVersion).toBe("0.0.1");
  });

  it("does not claim or signal a client from another protocol", async () => {
    const { mind, home } = await boot();
    const sessionId = "ses_foreign";
    const socketPath = path.join(home, "sessions", sessionId, "client.sock");
    await mkdir(path.dirname(socketPath), { recursive: true });
    const server = createServer((socket) => {
      socket.on("error", () => undefined);
    });
    await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));
    await writeFile(
      path.join(home, "sessions", sessionId, "record.json"),
      JSON.stringify({
        pid: process.pid,
        socketPath,
        protocol: PROTOCOL + 1,
        cwd: "/tmp",
        buildVersion: "old",
      }),
    );
    try {
      expect(await mind.lookup(sessionId)).toBeNull();
      const listed = await mind.list("/tmp");
      expect(listed.live.some((item) => item.sessionId === sessionId)).toBe(false);
      expect(pidAlive(process.pid)).toBe(true);
      const raw = await readFile(
        path.join(home, "sessions", sessionId, "record.json"),
        "utf8",
      );
      expect(raw).toContain(String(PROTOCOL + 1));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

async function boot(opts: { holdAfter?: string; version?: string } = {}): Promise<{
  mind: Mind;
  cwd: string;
  home: string;
}> {
  const home = await mkdtemp(path.join(tmpdir(), "min-mind-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "min-cwd-"));
  homes.push(home, cwd);
  const previousHold = process.env.MIN_CLIENT_TEST_HOLD_AFTER;
  const previousGrace = process.env.MIND_DRAIN_GRACE_MS;
  process.env.MIND_DRAIN_GRACE_MS = "400";
  if (opts.holdAfter === undefined) delete process.env.MIN_CLIENT_TEST_HOLD_AFTER;
  else process.env.MIN_CLIENT_TEST_HOLD_AFTER = opts.holdAfter;
  try {
    const mind = await ensureMind({
      home,
      clientEntry,
      buildVersion: opts.version ?? "0.1.0-alpha.4",
    });
    minds.push(mind);
    return { mind, cwd, home };
  } finally {
    if (previousHold === undefined) delete process.env.MIN_CLIENT_TEST_HOLD_AFTER;
    else process.env.MIN_CLIENT_TEST_HOLD_AFTER = previousHold;
    if (previousGrace === undefined) delete process.env.MIND_DRAIN_GRACE_MS;
    else process.env.MIND_DRAIN_GRACE_MS = previousGrace;
  }
}

async function waitFor(pred: () => boolean, ms = 3_000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
