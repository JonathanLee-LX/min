import { describe, expect, it } from "vitest";
import { createEditor, reduceEditor, type EditorState } from "./editor.js";
import type { EffortPickItem, ModelPickItem, SessionListItem } from "./commands.js";
import {
  applyPickerFilter,
  matchesPickerFilter,
  modelFilterHaystack,
  reducePickerFilter,
  sessionFilterHaystack,
  visibleEfforts,
  visibleModels,
  visibleSessions,
} from "./picker-filter.js";

function typeFilter(state: EditorState, text: string): EditorState {
  return reducePickerFilter(state, { op: "insert", text });
}

const sessions: SessionListItem[] = [
  {
    id: "sess-alpha",
    title: "Plan the launch",
    updatedAt: "2026-11-05T00:00:00.000Z",
    preview: "draft the announcement",
    latest: "ship it friday",
  },
  {
    id: "sess-beta",
    title: "Fix the picker",
    updatedAt: "2026-11-05T00:00:00.000Z",
    preview: "filter rows",
    latest: "type to search",
  },
];

const models: ModelPickItem[] = [
  {
    key: "model:gpt-4.1",
    name: "gpt-4.1",
    detail: "",
    current: true,
    supportsEffort: false,
    change: { type: "model", model: "gpt-4.1" },
  },
  {
    key: "model:o3",
    name: "o3",
    detail: "thinking",
    current: false,
    supportsEffort: true,
    change: { type: "model", model: "o3" },
  },
  {
    key: "saved:acme",
    name: "acme",
    detail: "deepseek deepseek-flash thinking",
    current: false,
    supportsEffort: true,
    change: { type: "provider", kind: "deepseek", model: "deepseek-flash" },
  },
];

describe("matchesPickerFilter", () => {
  it("keeps every item when the query is blank", () => {
    expect(matchesPickerFilter("gpt-4.1", "")).toBe(true);
    expect(matchesPickerFilter("gpt-4.1", "   ")).toBe(true);
  });

  it("matches case-insensitively and requires every token", () => {
    expect(matchesPickerFilter("Plan the Launch", "plan")).toBe(true);
    expect(matchesPickerFilter("Plan the Launch", "PLAN LAUNCH")).toBe(true);
    expect(matchesPickerFilter("Plan the Launch", "plan missing")).toBe(false);
  });
});

describe("visible picker rows", () => {
  it("filters sessions by id, title, preview, or latest prompt", () => {
    expect(visibleSessions(sessions, "alpha").map((session) => session.id)).toEqual([
      "sess-alpha",
    ]);
    expect(visibleSessions(sessions, "picker").map((session) => session.id)).toEqual([
      "sess-beta",
    ]);
    expect(visibleSessions(sessions, "friday").map((session) => session.id)).toEqual([
      "sess-alpha",
    ]);
    expect(visibleSessions(sessions, "nope")).toEqual([]);
    expect(sessionFilterHaystack(sessions[0]!)).toContain("sess-alpha");
  });

  it("filters models and effort rows by name or detail", () => {
    expect(visibleModels(models, "o3").map((item) => item.name)).toEqual(["o3"]);
    expect(visibleModels(models, "thinking").map((item) => item.name)).toEqual([
      "o3",
      "acme",
    ]);
    expect(visibleModels(models, "deepseek").map((item) => item.name)).toEqual(["acme"]);
    expect(modelFilterHaystack(models[2]!)).toContain("deepseek");

    const efforts: EffortPickItem[] = [
      { value: "high", name: "high", detail: "", current: true },
      { value: "default", name: "default", detail: "adapter default", current: false },
    ];
    expect(visibleEfforts(efforts, "def").map((item) => item.value)).toEqual(["default"]);
  });
});

describe("applyPickerFilter", () => {
  it("strips newlines and ignores vertical motion", () => {
    const typed = typeFilter(createEditor(), "o3\nmore");
    expect(typed.text).toBe("o3more");
    expect(reducePickerFilter(typed, { op: "newline" }).text).toBe("o3more");
    expect(reducePickerFilter(typed, { op: "up" }).cursor).toBe(typed.cursor);
  });

  it("keeps the highlighted item when it still matches", () => {
    const next = applyPickerFilter(
      models,
      2,
      createEditor(),
      { op: "insert", text: "acm" },
      (item) => item.key,
      modelFilterHaystack,
    );
    expect(next.visible.map((item) => item.name)).toEqual(["acme"]);
    expect(next.visible[next.selected]?.name).toBe("acme");
    expect(next.filter.text).toBe("acm");
  });

  it("falls back to the first match when the highlight is filtered out", () => {
    let filter = createEditor();
    filter = reduceEditor(filter, { op: "insert", text: "gpt" });
    const next = applyPickerFilter(
      models,
      0,
      filter,
      { op: "insert", text: "-nope" },
      (item) => item.key,
      modelFilterHaystack,
    );
    expect(next.visible).toEqual([]);
    expect(next.selected).toBe(0);
  });

  it("backspaces the filter and restores rows", () => {
    let filter = createEditor();
    filter = reduceEditor(filter, { op: "insert", text: "acme" });
    const next = applyPickerFilter(
      models,
      0,
      filter,
      { op: "backspace" },
      (item) => item.key,
      modelFilterHaystack,
    );
    expect(next.filter.text).toBe("acm");
    expect(next.visible.map((item) => item.name)).toEqual(["acme"]);
  });
});
