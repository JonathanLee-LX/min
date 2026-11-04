import { describe, expect, it } from "vitest";
import { formatResumeLine, layoutResumeRows, sessionWhen } from "./session-brief.js";
import { displayWidth } from "./text.js";

const now = new Date("2026-11-04T12:00:00.000Z");

const short = {
  id: "ses_short",
  updatedAt: "2026-11-04T10:16:00.000Z",
  title: "短",
  turns: 1,
  messageCount: 2,
};

const long = {
  id: "ses_m5abc_k2ab3c4d",
  updatedAt: "2025-01-02T08:00:00.000Z",
  preview: "修复通知的背景颜色",
  latest: "列表里看不出是哪一次对话",
  turns: 12,
  messageCount: 20,
};

function columnStart(row: { mark: string; name: string; detail: string }, field: "detail" | "meta"): number {
  const nameEnd = displayWidth(row.mark) + displayWidth(row.name);
  if (field === "detail") return nameEnd;
  return nameEnd + displayWidth(row.detail);
}

describe("resume rows", () => {
  it("aligns the name, latest prompt, turns, time, and id across rows", () => {
    const rows = layoutResumeRows([short, long], 96, short.id, now);
    expect(rows[0]!.mark).toBe("* ");
    expect(rows[1]!.mark).toBe("  ");
    expect(rows[0]!.name.trimEnd()).toBe("短");
    expect(rows[1]!.name.trimEnd()).toBe("修复通知的背景颜色");
    expect(rows[0]!.detail).not.toContain("→");
    expect(rows[1]!.detail).toContain("→");
    expect(rows[1]!.detail).toContain("列表里看不出");
    expect(rows[0]!.meta).toContain("1 turn");
    expect(rows[1]!.meta).toContain("12 turns");
    expect(rows[1]!.meta).toContain("…ab3c4d");
    expect(rows[1]!.meta).not.toContain("ses_m5abc");

    expect(rows[0]!.meta.indexOf("1 turn")).toBe(rows[1]!.meta.indexOf("12 turns"));
    expect(displayWidth(rows[0]!.name)).toBe(displayWidth(rows[1]!.name));
    expect(displayWidth(rows[0]!.detail)).toBe(displayWidth(rows[1]!.detail));
    expect(displayWidth(rows[0]!.meta)).toBe(displayWidth(rows[1]!.meta));
    expect(columnStart(rows[0]!, "meta")).toBe(columnStart(rows[1]!, "meta"));
    expect(displayWidth(formatResumeLine(rows[0]!))).toBeLessThanOrEqual(96);
    expect(displayWidth(formatResumeLine(rows[1]!))).toBeLessThanOrEqual(96);
  });

  it("lets a custom title replace the first-message preview", () => {
    const named = layoutResumeRows([{ ...long, title: "通知颜色" }], 72, long.id, now);
    expect(named[0]!.name.trimEnd()).toBe("通知颜色");
    expect(named[0]!.name.trimEnd().startsWith("修复通知")).toBe(false);
    expect(named[0]!.detail).toContain("列表里看不出");
  });

  it("clips a long name before the meta columns on a narrow row", () => {
    const narrow = {
      ...long,
      preview: "修复".repeat(40),
      latest: undefined,
      title: undefined,
    };
    const rows = layoutResumeRows([narrow], 48, "", now);
    const line = formatResumeLine(rows[0]!);
    expect(rows[0]!.name.endsWith("…")).toBe(true);
    expect(rows[0]!.detail).toBe("");
    expect(rows[0]!.meta).toContain("12 turns");
    expect(rows[0]!.meta).toContain("…ab3c4d");
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
