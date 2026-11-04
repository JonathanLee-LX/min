import { describe, expect, it } from "vitest";
import { composerFrameRows } from "./chrome-layout.js";

describe("composerFrameRows", () => {
  it("keeps the composer on the same row when the command list opens", () => {
    const base = {
      paintRows: 40,
      activityRows: 0,
      permBlockRows: 0,
      inputRows: 1,
      bottomStatusRows: 2,
    };
    const closed = composerFrameRows({ ...base, suggestRows: 0 });
    const open = composerFrameRows({ ...base, suggestRows: 8 });
    expect(open.rowsAboveComposer).toBe(closed.rowsAboveComposer);
    expect(open.rowsBelowComposer).toBe(closed.rowsBelowComposer);
    expect(open.logHeight).toBe(closed.logHeight - 8);
  });
});