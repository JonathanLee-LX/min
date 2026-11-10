import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFsBlobStore,
  createMemoryBlobStore,
  hydrateMediaParts,
  sha256Hex,
  stripMediaData,
} from "./blobs.js";
import { PNG_SIG } from "./media.fixtures.js";
import { imagePart, userMessageWithParts } from "@min-agent/core";

describe("BlobStore", () => {
  it("writes bytes under session blobs by sha256", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "min-blobs-"));
    const store = createFsBlobStore(path.join(root, "blobs"));
    const id = await store.put(PNG_SIG);
    expect(id).toBe(sha256Hex(PNG_SIG));
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(path.join(root, "blobs", id))).toEqual(Buffer.from(PNG_SIG));
    expect(await store.get(id)).toEqual(PNG_SIG);
    rmSync(root, { recursive: true, force: true });
  });

  it("dedupes identical bytes to one file", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "min-blobs-"));
    const dir = path.join(root, "blobs");
    const store = createFsBlobStore(dir);
    const a = await store.put(PNG_SIG);
    const b = await store.put(PNG_SIG);
    expect(a).toBe(b);
    expect(readdirSync(dir)).toEqual([a]);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects blobId with path separators", async () => {
    const store = createMemoryBlobStore();
    await expect(store.get("../x")).rejects.toThrow(/invalid blob id/);
    await expect(store.get("aa/bb")).rejects.toThrow(/invalid blob id/);
  });

  it("reads only from the given session blob dir", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "min-blobs-"));
    const a = createFsBlobStore(path.join(root, "ses_a", "blobs"));
    const b = createFsBlobStore(path.join(root, "ses_b", "blobs"));
    const id = await a.put(PNG_SIG);
    await expect(b.get(id)).rejects.toThrow();
    rmSync(root, { recursive: true, force: true });
  });
});

describe("stripMediaData / hydrateMediaParts", () => {
  it("strips data from persisted parts and hydrates it back", async () => {
    const blobs = createMemoryBlobStore();
    const blobId = await blobs.put(PNG_SIG);
    const user = userMessageWithParts([
      imagePart({
        mediaType: "image/png",
        blobId,
        filename: "shot.png",
        data: PNG_SIG,
      }),
    ]);
    const stripped = stripMediaData([user]);
    expect(stripped[0]?.content[0]).toEqual({
      type: "image",
      mediaType: "image/png",
      blobId,
      filename: "shot.png",
    });
    const json = JSON.stringify(stripped);
    expect(json).not.toContain("data:");
    expect(json).not.toMatch(/"data"/);
    const hydrated = await hydrateMediaParts(stripped, blobs);
    const part = hydrated[0]?.content[0];
    expect(part?.type).toBe("image");
    if (part?.type === "image") expect(part.data).toEqual(PNG_SIG);
  });
});
