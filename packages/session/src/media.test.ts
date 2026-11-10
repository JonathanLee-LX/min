import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPTY,
  GIF_SIG,
  JPEG_SIG,
  OLE_SIG,
  PDF_SIG,
  PNG_SIG,
  README_TXT,
  SVG_XML,
  WEBP_SIG,
  ZIP_SIG,
  withPdfHeader,
  withPngHeader,
} from "./media.fixtures.js";
import {
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_TEXT_BYTES,
  classifyAttachment,
  classifyAttachments,
  decideTurnSubmit,
  readTurnFiles,
} from "./media.js";

describe("classifyAttachment", () => {
  it("classifies png jpeg gif webp by magic", () => {
    expect(classifyAttachment({ bytes: PNG_SIG, filename: "a.png" })).toMatchObject({
      kind: "image",
      mediaType: "image/png",
    });
    expect(classifyAttachment({ bytes: JPEG_SIG, filename: "a.jpg" })).toMatchObject({
      kind: "image",
      mediaType: "image/jpeg",
    });
    expect(classifyAttachment({ bytes: GIF_SIG, filename: "a.gif" })).toMatchObject({
      kind: "image",
      mediaType: "image/gif",
    });
    expect(classifyAttachment({ bytes: WEBP_SIG, filename: "a.webp" })).toMatchObject({
      kind: "image",
      mediaType: "image/webp",
    });
  });

  it("classifies pdf by magic", () => {
    expect(classifyAttachment({ bytes: PDF_SIG, filename: "spec.pdf" })).toMatchObject({
      kind: "document",
      mediaType: "application/pdf",
    });
  });

  it("reads utf8 text attachments", () => {
    const got = classifyAttachment({ bytes: README_TXT, filename: "notes.md" });
    expect(got).toEqual({ kind: "text", filename: "notes.md", text: "hello from file" });
  });

  it("rejects svg even with image/svg+xml", () => {
    expect(() =>
      classifyAttachment({
        bytes: SVG_XML,
        filename: "icon.svg",
        mediaType: "image/svg+xml",
      }),
    ).toThrow(/svg/i);
  });

  it("rejects magic / extension mismatch", () => {
    expect(() =>
      classifyAttachment({ bytes: JPEG_SIG, filename: "shot.png" }),
    ).toThrow(/mismatch/i);
  });

  it("rejects empty bytes", () => {
    expect(() => classifyAttachment({ bytes: EMPTY, filename: "a.png" })).toThrow(
      /empty/i,
    );
  });

  it("rejects image over 5 MiB", () => {
    expect(() =>
      classifyAttachment({ bytes: withPngHeader(MAX_IMAGE_BYTES + 1), filename: "a.png" }),
    ).toThrow(/5/);
  });

  it("rejects pdf over 20 MiB", () => {
    expect(() =>
      classifyAttachment({ bytes: withPdfHeader(MAX_PDF_BYTES + 1), filename: "a.pdf" }),
    ).toThrow(/20/);
  });

  it("rejects a ninth attachment", () => {
    const items = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => ({
      bytes: PNG_SIG,
      filename: `a${i}.png`,
    }));
    expect(() => classifyAttachments(items)).toThrow(/8/);
  });

  it("rejects zip and office bytes", () => {
    expect(() => classifyAttachment({ bytes: ZIP_SIG, filename: "a.zip" })).toThrow(
      /zip|office/i,
    );
    expect(() => classifyAttachment({ bytes: OLE_SIG, filename: "a.doc" })).toThrow(
      /office/i,
    );
  });

  it("caps text attachments at 200_000 bytes", () => {
    const bytes = new TextEncoder().encode("a".repeat(MAX_TEXT_BYTES + 1));
    expect(() => classifyAttachment({ bytes, filename: "notes.txt" })).toThrow(
      String(MAX_TEXT_BYTES),
    );
  });
});

describe("decideTurnSubmit", () => {
  it("sends attachments when idle and refuses to queue them while busy", () => {
    expect(decideTurnSubmit({ text: "", attachmentCount: 1, busy: false })).toEqual({
      type: "send",
      text: "",
    });
    expect(decideTurnSubmit({ text: "hi", attachmentCount: 1, busy: true })).toEqual({
      type: "reject",
      reason: "attachments-while-busy",
    });
    expect(decideTurnSubmit({ text: "hi", attachmentCount: 0, busy: true })).toEqual({
      type: "queue",
      text: "hi",
    });
    expect(decideTurnSubmit({ text: "  ", attachmentCount: 0, busy: false })).toEqual({
      type: "empty",
    });
  });
});

describe("readTurnFiles", () => {
  it("reads paths outside the workspace by basename", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "min-attach-"));
    const file = path.join(dir, "shot.png");
    await writeFile(file, PNG_SIG);
    const [item] = await readTurnFiles([file]);
    expect(item?.filename).toBe("shot.png");
    expect(item?.bytes).toEqual(PNG_SIG);
  });

  it("throws when the file is missing", async () => {
    await expect(readTurnFiles(["/tmp/min-missing-file-xyz.png"])).rejects.toThrow();
  });
});
