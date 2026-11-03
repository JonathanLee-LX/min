import { noticeLog } from "@min-agent/core";
import { mockProvider } from "@min-agent/core";
import { describe, expect, it } from "vitest";
import { createClient } from "./client.js";

describe("client notices", () => {
  it("exposes the process log and stops delivering after dispose", async () => {
    noticeLog.clear();
    noticeLog.record({ source: "config", level: "warning", message: "legacy file" });
    const client = await createClient({
      cwd: process.cwd(),
      provider: mockProvider([{ text: "ok" }]),
      noTools: true,
      noSessionStore: true,
    });
    const seen: string[] = [];
    const unsub = client.notices.subscribe((notice) => seen.push(notice.message));
    expect(client.notices.list().map((notice) => notice.message)).toEqual(["legacy file"]);
    noticeLog.record({ source: "config", message: "later" });
    expect(seen).toEqual(["later"]);
    unsub();
    await client.dispose();
    noticeLog.record({ source: "config", message: "after dispose" });
    expect(seen).toEqual(["later"]);
    noticeLog.clear();
  });
});
