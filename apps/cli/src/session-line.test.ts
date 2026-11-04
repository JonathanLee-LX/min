import { describe, expect, it } from "vitest";
import { displayWidth, formatCliSessionLines } from "./session-line.js";

const short = {
  id: "ses_short",
  updatedAt: "2026-11-04T10:16:00.000Z",
  title: "短",
  preview: "短",
  latest: "",
  turns: 1,
  messageCount: 2,
  createdAt: "2026-11-04T10:00:00.000Z",
};

const long = {
  id: "ses_m5abc_k2ab3c4d",
  updatedAt: "2025-01-02T08:00:00.000Z",
  title: "",
  preview: "修复通知的背景颜色",
  latest: "列表里看不出是哪一次对话",
  turns: 12,
  messageCount: 20,
  createdAt: "2025-01-02T07:00:00.000Z",
};

describe("formatCliSessionLines", () => {
  it("aligns the name, latest prompt, turns, and time", () => {
    const [first, second] = formatCliSessionLines([short, long], short.id);
    expect(first!.startsWith("* 短")).toBe(true);
    expect(second).toContain("修复通知的背景颜色");
    expect(second).toContain("→");
    expect(first).toContain("1 turn");
    expect(second).toContain("12 turns");

    const column = (line: string, label: string) => displayWidth(line.slice(0, line.indexOf(label)));
    expect(column(first!, "1 turn")).toBe(column(second!, "12 turns"));
    expect(column(first!, short.updatedAt)).toBe(column(second!, long.updatedAt));
  });
});
