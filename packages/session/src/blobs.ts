import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  documentPart,
  imagePart,
  textPart,
  type ContentPart,
  type Message,
} from "@min-agent/core";
import {
  classifyAttachments,
  type ClassifiedAttachment,
  type TurnAttachment,
} from "./media.js";

const BLOB_ID = /^[a-f0-9]{64}$/;

export interface BlobStore {
  put(bytes: Uint8Array): Promise<string>;
  get(blobId: string): Promise<Uint8Array>;
}

export function createMemoryBlobStore(): BlobStore {
  const map = new Map<string, Uint8Array>();
  return {
    async put(bytes) {
      const id = sha256Hex(bytes);
      if (!map.has(id)) map.set(id, bytes.slice());
      return id;
    },
    async get(blobId) {
      assertBlobId(blobId);
      const hit = map.get(blobId);
      if (!hit) throw new Error(`unknown blob: ${blobId}`);
      return hit.slice();
    },
  };
}

export function createFsBlobStore(dir: string): BlobStore {
  const root = path.resolve(dir);
  return {
    async put(bytes) {
      const id = sha256Hex(bytes);
      assertBlobId(id);
      await mkdir(root, { recursive: true });
      const dest = path.join(root, id);
      try {
        await writeFile(dest, bytes, { flag: "wx" });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      return id;
    },
    async get(blobId) {
      assertBlobId(blobId);
      return new Uint8Array(await readFile(path.join(root, blobId)));
    },
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function stripMediaData(messages: Message[]): Message[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.map(stripPart),
  }));
}

export async function hydrateMediaParts(
  messages: readonly Message[],
  blobs: BlobStore,
): Promise<Message[]> {
  const out: Message[] = [];
  for (const message of messages) {
    const content: ContentPart[] = [];
    for (const part of message.content) {
      content.push(await hydratePart(part, blobs));
    }
    out.push({ role: message.role, content });
  }
  return out;
}

export async function userMessageFromAttachments(
  text: string,
  attachments: readonly TurnAttachment[],
  blobs: BlobStore,
): Promise<Message | undefined> {
  const classified = classifyAttachments(attachments);
  const content: ContentPart[] = [];
  const trimmed = text.trim();
  if (trimmed) content.push(textPart(trimmed));
  for (const item of classified) {
    content.push(await partFromClassified(item, blobs));
  }
  if (content.length === 0) return undefined;
  return { role: "user", content };
}

export function firstAttachmentTitle(
  text: string,
  parts: readonly ContentPart[],
): string {
  const typed = text.replace(/\s+/g, " ").trim();
  if (typed) return typed;
  for (const part of parts) {
    if (part.type === "image" || part.type === "document") {
      const name = part.filename?.trim();
      if (name) return name;
    }
    if (part.type === "text") {
      const line = part.text.replace(/\s+/g, " ").trim();
      if (line) return line;
    }
  }
  return "";
}

export function mediaLabel(part: ContentPart): string | undefined {
  if (part.type === "image") {
    return `image ${part.filename?.trim() || part.blobId.slice(0, 8)}`;
  }
  if (part.type === "document") {
    return `document ${part.filename?.trim() || "file.pdf"}`;
  }
  return undefined;
}

function stripPart(part: ContentPart): ContentPart {
  if (part.type === "image") {
    return imagePart({
      mediaType: part.mediaType,
      blobId: part.blobId,
      filename: part.filename,
    });
  }
  if (part.type === "document") {
    return documentPart({ blobId: part.blobId, filename: part.filename });
  }
  return part;
}

async function hydratePart(part: ContentPart, blobs: BlobStore): Promise<ContentPart> {
  if (part.type !== "image" && part.type !== "document") return part;
  if (part.data && part.data.byteLength > 0) return part;
  const data = await blobs.get(part.blobId);
  return part.type === "image"
    ? imagePart({
        mediaType: part.mediaType,
        blobId: part.blobId,
        filename: part.filename,
        data,
      })
    : documentPart({ blobId: part.blobId, filename: part.filename, data });
}

async function partFromClassified(
  item: ClassifiedAttachment,
  blobs: BlobStore,
): Promise<ContentPart> {
  if (item.kind === "text") {
    const header = item.filename ? `Attached ${item.filename}\n` : "";
    return textPart(`${header}${item.text}`);
  }
  const blobId = await blobs.put(item.bytes);
  if (item.kind === "image") {
    return imagePart({
      mediaType: item.mediaType,
      blobId,
      filename: item.filename,
    });
  }
  return documentPart({ blobId, filename: item.filename });
}

function assertBlobId(blobId: string): void {
  if (!BLOB_ID.test(blobId)) {
    throw new Error(`invalid blob id: ${blobId}`);
  }
}
