import { describe, expect, it } from "vitest";
import { parseReasoningEffort } from "./effort.js";

describe("parseReasoningEffort", () => {
  it("accepts the five intensity names and drops anything else", () => {
    expect(parseReasoningEffort(" High ")).toBe("high");
    expect(parseReasoningEffort("none")).toBe("none");
    expect(parseReasoningEffort("max")).toBe("max");
    expect(parseReasoningEffort("turbo")).toBeUndefined();
    expect(parseReasoningEffort("")).toBeUndefined();
    expect(parseReasoningEffort(1)).toBeUndefined();
  });
});
