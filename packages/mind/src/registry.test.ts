import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimRecords,
  defaultRecord,
  readClientRecord,
  removeClientRecord,
  writeClientRecord,
} from "./registry.js";
import { MIND_PROTOCOL } from "./version.js";

const temps: string[] = [];

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "min-mind-"));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("client registry", () => {
  it("drops dead pid entries on claim", async () => {
    const root = await tmpRoot();
    await writeClientRecord(
      root,
      defaultRecord({
        root,
        sessionId: "ses_dead",
        cwd: root,
        pid: 99999999,
        protocol: MIND_PROTOCOL,
        buildVersion: "test",
        autoApprove: false,
      }),
    );
    const result = await claimRecords(root);
    expect(result.claimed).toEqual([]);
    expect(result.dropped.map((r) => r.sessionId)).toEqual(["ses_dead"]);
    expect(await readClientRecord(root, "ses_dead")).toBeNull();
  });

  it("does not claim or delete a different protocol", async () => {
    const root = await tmpRoot();
    await writeClientRecord(
      root,
      defaultRecord({
        root,
        sessionId: "ses_old",
        cwd: root,
        pid: process.pid,
        protocol: MIND_PROTOCOL + 1,
        buildVersion: "old",
        autoApprove: false,
      }),
    );
    const result = await claimRecords(root);
    expect(result.claimed).toEqual([]);
    expect(result.skippedProtocol.map((r) => r.sessionId)).toEqual(["ses_old"]);
    expect(await readClientRecord(root, "ses_old")).not.toBeNull();
    await removeClientRecord(root, "ses_old");
  });
});
