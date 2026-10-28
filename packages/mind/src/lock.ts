import { mkdir, open, readFile, rm, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import { isPidAlive } from "./ipc.js";
import { mindPaths } from "./paths.js";
import { socketConnectable } from "./registry.js";
import { MIND_PROTOCOL, mindBuildVersion } from "./version.js";

export interface PidPayload {
  pid: number;
  protocol: number;
  buildVersion: string;
}

export interface MindLock {
  handle: FileHandle;
  payload: PidPayload;
}

async function readPidPayload(pidPath: string): Promise<PidPayload | null> {
  try {
    const raw = (await readFile(pidPath, "utf8")).trim();
    if (/^\d+$/.test(raw)) {
      return { pid: Number(raw), protocol: 0, buildVersion: "" };
    }
    const parsed = JSON.parse(raw) as Partial<PidPayload>;
    if (typeof parsed.pid !== "number") return null;
    return {
      pid: parsed.pid,
      protocol: typeof parsed.protocol === "number" ? parsed.protocol : 0,
      buildVersion: typeof parsed.buildVersion === "string" ? parsed.buildVersion : "",
    };
  } catch {
    return null;
  }
}

export async function existingMind(
  root?: string,
): Promise<(PidPayload & { socketReady: boolean }) | null> {
  const paths = mindPaths(root);
  const payload = await readPidPayload(paths.pid);
  if (!payload) return null;
  if (!isPidAlive(payload.pid)) return null;
  const socketReady = await socketConnectable(paths.sock);
  return { ...payload, socketReady };
}

export async function acquireMindLock(root?: string): Promise<
  | { status: "acquired"; lock: MindLock }
  | { status: "running"; payload: PidPayload; socketReady: boolean }
> {
  const paths = mindPaths(root);
  await mkdir(paths.root, { recursive: true });

  const tryOpen = async (): Promise<FileHandle | "exists"> => {
    try {
      return await open(
        paths.pid,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return "exists";
      throw err;
    }
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const opened = await tryOpen();
    if (opened !== "exists") {
      const payload: PidPayload = {
        pid: process.pid,
        protocol: MIND_PROTOCOL,
        buildVersion: mindBuildVersion(),
      };
      await opened.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
      return { status: "acquired", lock: { handle: opened, payload } };
    }

    const payload = await readPidPayload(paths.pid);
    if (payload && isPidAlive(payload.pid)) {
      const socketReady = await socketConnectable(paths.sock);
      return { status: "running", payload, socketReady };
    }

    try {
      await unlink(paths.pid);
    } catch {
      // ignore
    }
    try {
      await rm(paths.sock, { force: true });
    } catch {
      // ignore
    }
  }

  throw new Error(`could not acquire mind lock at ${paths.pid}`);
}

export async function releaseMindLock(lock: MindLock, root?: string): Promise<void> {
  const paths = mindPaths(root);
  try {
    await lock.handle.close();
  } catch {
    // ignore
  }
  try {
    await unlink(paths.pid);
  } catch {
    // ignore
  }
  try {
    await rm(paths.sock, { force: true });
  } catch {
    // ignore
  }
}
