import { describe, expect, it } from "vitest";
import { documentPart, imagePart, textPart } from "@min-agent/core";
import { messageTextApprox } from "./compact-prompt.js";
import { PNG_SIG } from "./media.fixtures.js";

describe("messageTextApprox", () => {
  it("summarizes image and document as filenames not bytes", () => {
    const text = messageTextApprox([
      {
        role: "user",
        content: [
          textPart("look"),
          imagePart({
            mediaType: "image/png",
            blobId: "a".repeat(64),
            filename: "shot.png",
            data: PNG_SIG,
          }),
          documentPart({ blobId: "b".repeat(64), filename: "spec.pdf" }),
        ],
      },
    ]);
    expect(text).toContain("image shot.png");
    expect(text).toContain("document spec.pdf");
    expect(text).not.toContain("data:image");
    expect(text).not.toContain("PNG");
  });

  it("throws on unknown content parts instead of dropping them", () => {
    expect(() =>
      messageTextApprox([
        { role: "user", content: [{ type: "audio" } as never] },
      ]),
    ).toThrow(/unknown content part: audio/);
  });
});
