import { describe, expect, it } from "vitest";
import { formatResumeRow, resumeRowParts, sessionWhen } from "./session-brief.js";
import { displayWidth } from "./text.js";

const session = {
  id: "ses_m5abc_k2ab3c4d",
  updatedAt: "2026-11-04T10:16:00.000Z",
  preview: "修复通知的背景颜色",
  latest: "列表里看不出是哪一次对话",
  turns: 4,
  messageCount: 9,
};

const now = new Date("2026-11-04T12:00:00.000Z");

describe("resume rows", () => {
  it("leads with the topic and keeps turns, time, and a short id", () => {
    const parts = resumeRowParts(session, 72, true, now);
    expect(parts.mark).toBe("* ");
    expect(parts.topic.startsWith("修复通知")).toBe(true);
    const named = resumeRowParts({ ...session, title: "通知颜色" }, 72, true, now);
    expect(named.topic.startsWith("通知颜色")).toBe(true);
    expect(named.topic.startsWith("修复通知")).toBe(false);
    expect(parts.topic).toContain("→");
    expect(parts.meta).toContain("4 turns");
    expect(parts.meta).toContain("…ab3c4d");
    expect(parts.meta).not.toContain("ses_m5abc");
    expect(displayWidth(`${parts.mark}${parts.topic}${parts.meta}`)).toBeLessThanOrEqual(72);
  });

  it("clips a long topic before the meta on a narrow row", () => {
    const narrow = { ...session, preview: "x".repeat(80), latest: undefined };
    const parts = resumeRowParts(narrow, 48, false, now);
    const line = formatResumeRow(narrow, 48, false, now);
    expect(parts.topic.endsWith("…")).toBe(true);
    expect(parts.meta).toContain("4 turns");
    expect(displayWidth(line)).toBeLessThanOrEqual(48);
  });

  it("formats the stamp in local time", () => {
    const iso = "2026-03-09T15:04:00.000Z";
    const date = new Date(iso);
    const pad = (value: number) => String(value).padStart(2, "0");
    expect(sessionWhen(iso, new Date(date.getFullYear(), 0, 1))).toBe(
      `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
    );
  });
});
