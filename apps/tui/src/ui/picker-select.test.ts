import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink";
import { PassThrough } from "node:stream";
import { createEditor, reduceEditor } from "../editor.js";
import { ModelSelect } from "./ModelSelect.js";
import { PICKER_FILTER_PLACEHOLDER } from "./PickerFilter.js";
import { SessionSelect } from "./SessionSelect.js";

async function renderUntil(
  element: React.ReactElement,
  predicate: (output: string) => boolean,
): Promise<string> {
  const stream = new PassThrough();
  (stream as { isTTY?: boolean }).isTTY = true;
  (stream as { columns?: number }).columns = 80;
  (stream as { rows?: number }).rows = 24;
  let output = "";
  stream.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  const instance = render(element, {
    stdout: stream as unknown as NodeJS.WriteStream,
    debug: true,
  });
  const deadline = Date.now() + 1000;
  while (!predicate(output) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  instance.unmount();
  return output;
}

describe("picker filter field", () => {
  it("renders a filter input on the session list", async () => {
    const output = await renderUntil(
      React.createElement(SessionSelect, {
        sessions: [
          {
            id: "sess-alpha",
            title: "Plan the launch",
            updatedAt: "2026-11-05T00:00:00.000Z",
          },
        ],
        currentId: "sess-alpha",
        selectedIndex: 0,
        columns: 72,
        filter: createEditor(),
      }),
      (text) => text.includes("Plan the launch") && text.includes("filter"),
    );
    expect(output).toContain("filter");
    expect(output).toContain(PICKER_FILTER_PLACEHOLDER);
    expect(output).toContain("Plan the launch");
  });

  it("shows the typed filter query on the model list", async () => {
    const filter = reduceEditor(createEditor(), { op: "insert", text: "o3" });
    const output = await renderUntil(
      React.createElement(ModelSelect, {
        items: [
          { name: "gpt-4.1", detail: "", current: true },
          { name: "o3", detail: "thinking", current: false },
        ],
        selectedIndex: 0,
        columns: 72,
        filter,
      }),
      (text) => text.includes("o3") && text.includes("filter"),
    );
    expect(output).toContain("filter");
    expect(output).toContain("o3");
    expect(output).not.toContain(PICKER_FILTER_PLACEHOLDER);
  });

  it("shows an empty-match line when the filtered list is empty", async () => {
    const output = await renderUntil(
      React.createElement(ModelSelect, {
        items: [
          { name: "gpt-4.1", detail: "", current: true },
          { name: "o3", detail: "thinking", current: false },
        ],
        selectedIndex: 0,
        columns: 72,
        filter: reduceEditor(createEditor(), { op: "insert", text: "zzz" }),
      }),
      (text) => text.includes("(no matches)"),
    );
    expect(output).toContain("filter");
    expect(output).toContain("zzz");
    expect(output).toContain("(no matches)");
    expect(output).not.toContain("gpt-4.1");
  });
});
