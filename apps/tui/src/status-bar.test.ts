import { describe, expect, it } from "vitest";
import type { ContextUsage } from "@min-agent/client";
import {
  bottomStatusLines,
  contextPercentLabel,
  modelDisplayName,
  modelStatusLine,
  shortenPath,
  thinkingIntensityLabel,
  workspaceStatusLine,
} from "./status-bar.js";

describe("status-bar", () => {
  it("shortens home paths", () => {
    expect(shortenPath("/home/me/proj", "/home/me")).toBe("~/proj");
    expect(shortenPath("/home/me", "/home/me")).toBe("~");
    expect(shortenPath("/tmp/x", "/home/me")).toBe("/tmp/x");
  });

  it("pulls the model id out of provider:model", () => {
    expect(modelDisplayName("deepseek:deepseek-flash")).toBe("deepseek-flash");
    expect(modelDisplayName("mock")).toBe("mock");
  });

  it("labels deepseek thinking intensity as high by default", () => {
    expect(thinkingIntensityLabel("deepseek:deepseek-flash")).toBe("high");
    expect(thinkingIntensityLabel("mock")).toBeUndefined();
  });

  it("formats workspace and model lines", () => {
    const usage = {
      used: 12_400,
      limit: 32_000,
      ratio: 0.394,
    } as ContextUsage;
    expect(workspaceStatusLine("/tmp/proj", "main")).toBe("/tmp/proj  main");
    expect(workspaceStatusLine("/tmp/proj", null)).toBe("/tmp/proj");
    expect(modelStatusLine("deepseek:deepseek-flash", usage)).toBe(
      "deepseek-flash (high)  12k/32k 39%",
    );
    expect(modelStatusLine("mock", undefined)).toBe("mock  —");
    expect(contextPercentLabel(usage)).toBe("12k/32k 39%");
  });

  it("builds the two-line bottom status", () => {
    const usage = {
      used: 4_200,
      limit: 32_000,
      ratio: 0.2,
    } as ContextUsage;
    expect(bottomStatusLines("/tmp/proj", "deepseek:deepseek-flash", usage, "main")).toEqual([
      "/tmp/proj  main",
      "deepseek-flash (high)  4.2k/32k 20%",
    ]);
  });
});
