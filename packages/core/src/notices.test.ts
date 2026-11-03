import { describe, expect, it } from "vitest";
import { createNoticeLog } from "./notices.js";

describe("notice log", () => {
  it("records a snapshot and then only new items for subscribers", () => {
    const log = createNoticeLog();
    const seen: string[] = [];
    log.record({ source: "config", message: "already there", level: "warning" });
    const unsub = log.subscribe((notice) => seen.push(notice.message));
    expect(log.list().map((notice) => notice.message)).toEqual(["already there"]);
    expect(seen).toEqual([]);
    log.record({ source: "config", message: "next" });
    expect(seen).toEqual(["next"]);
    expect(log.list().map((notice) => notice.level)).toEqual(["warning", "info"]);
    unsub();
    log.record({ source: "config", message: "after" });
    expect(seen).toEqual(["next"]);
  });

  it("drops a blank message or source", () => {
    const log = createNoticeLog();
    expect(log.record({ source: "config", message: "  " })).toBeUndefined();
    expect(log.record({ source: " ", message: "hi" })).toBeUndefined();
    expect(log.list()).toEqual([]);
  });
});
