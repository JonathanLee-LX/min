import { describe, expect, it } from "vitest";
import { documentPart, imagePart, textPart, userMessage } from "@min-agent/core";
import { IMAGE_TOKEN_ESTIMATE, PDF_TOKEN_ESTIMATE } from "./media.js";
import { estimateMessageTokens, estimateTextTokens } from "./tokens.js";

describe("estimateMessageTokens", () => {
  it("counts image as 1600 tokens and pdf as 2000", () => {
    const image = {
      role: "user" as const,
      content: [
        imagePart({ mediaType: "image/png", blobId: "a".repeat(64), filename: "shot.png" }),
      ],
    };
    const pdf = {
      role: "user" as const,
      content: [documentPart({ blobId: "b".repeat(64), filename: "spec.pdf" })],
    };
    expect(estimateMessageTokens(image)).toBeGreaterThanOrEqual(IMAGE_TOKEN_ESTIMATE);
    expect(estimateMessageTokens(pdf)).toBeGreaterThanOrEqual(PDF_TOKEN_ESTIMATE);
    const text = userMessage("x".repeat(40));
    expect(estimateMessageTokens(text)).toBeLessThan(IMAGE_TOKEN_ESTIMATE);
    expect(estimateMessageTokens({ role: "user", content: [textPart("hi")] })).toBe(
      4 + estimateTextTokens("hi"),
    );
  });

  it("throws on unknown content parts instead of counting them as zero", () => {
    expect(() =>
      estimateMessageTokens({
        role: "user",
        content: [{ type: "audio" } as never],
      }),
    ).toThrow(/unknown content part: audio/);
  });
});
