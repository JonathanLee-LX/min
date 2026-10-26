import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as core from "./index.js";
import {
  assistantMessage,
  lastAssistantText,
  messageText,
  messageToolCalls,
  systemMessage,
  textPart,
  toolCallPart,
  toolMessage,
  toolResultPart,
  userMessage,
} from "./messages.js";
import { defineTool, ToolRegistry } from "./tools.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Freeze the harness-facing export surface for the first alpha. */
const PUBLIC_EXPORTS = [
  "Runner",
  "ToolRegistry",
  "assistantMessage",
  "createAgent",
  "defineTool",
  "lastAssistantText",
  "messageText",
  "messageToolCalls",
  "mockProvider",
  "systemMessage",
  "textPart",
  "toolCallPart",
  "toolMessage",
  "toolResultPart",
  "toolToDefinition",
  "userMessage",
].sort();

const VENDOR_IMPORT = /from\s+["'](@anthropic-ai\/sdk|openai|@modelcontextprotocol\/sdk)["']/;

describe("core architecture contracts", () => {
  it("exposes a stable public API surface", () => {
    expect(Object.keys(core).sort()).toEqual(PUBLIC_EXPORTS);
  });

  it("stays provider-agnostic: no vendor SDK imports in core source", () => {
    const src = path.join(ROOT, "src");
    const offenders: string[] = [];
    for (const name of readdirSync(src)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      const text = readFileSync(path.join(src, name), "utf8");
      if (VENDOR_IMPORT.test(text)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it("depends only on zod tooling, not other @min-agent packages", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps.every((name) => !name.startsWith("@min-agent/"))).toBe(true);
    expect(deps).toEqual(expect.arrayContaining(["zod", "zod-to-json-schema"]));
  });

  it("builds messages from structured ContentParts, not raw strings", () => {
    const user = userMessage("hi");
    expect(user).toEqual({ role: "user", content: [{ type: "text", text: "hi" }] });
    const sys = systemMessage("rules");
    expect(sys.role).toBe("system");
    const call = toolCallPart("c1", "bash", { command: "ls" });
    const assistant = assistantMessage([textPart("running"), call]);
    expect(messageText(assistant)).toBe("running");
    expect(messageToolCalls(assistant)).toEqual([call]);
    const tool = toolMessage([toolResultPart("c1", "ok")]);
    expect(tool.role).toBe("tool");
    expect(lastAssistantText([user, assistant, tool])).toBe("running");
  });

  it("folds tool execution failures into isError results (never throws to the model)", async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        name: "boom",
        description: "throws",
        inputSchema: z.object({}),
        async execute() {
          throw new Error("nope");
        },
      }),
    );
    const result = await registry.execute("boom", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("nope");
  });
});
