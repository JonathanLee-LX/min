import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImageMediaType } from "@min-agent/core";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_BYTES = 200_000;
export const MAX_ATTACHMENTS = 8;
export const IMAGE_TOKEN_ESTIMATE = 1600;
export const PDF_TOKEN_ESTIMATE = 2000;

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "csv",
  "tsv",
  "yml",
  "yaml",
  "xml",
  "html",
  "css",
  "js",
  "ts",
  "tsx",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rs",
  "go",
  "java",
  "kt",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "rb",
  "php",
  "sh",
  "bash",
  "zsh",
  "toml",
  "ini",
  "sql",
  "graphql",
  "vue",
  "svelte",
  "scss",
  "less",
  "swift",
  "m",
  "lua",
  "pl",
  "ps1",
  "r",
  "rst",
  "tex",
]);

const IMAGE_EXT: Record<string, ImageMediaType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export interface TurnAttachment {
  filename?: string;
  mediaType?: string;
  bytes: Uint8Array;
}

export type ClassifiedAttachment =
  | {
      kind: "image";
      mediaType: ImageMediaType;
      filename?: string;
      bytes: Uint8Array;
    }
  | {
      kind: "document";
      mediaType: "application/pdf";
      filename?: string;
      bytes: Uint8Array;
    }
  | {
      kind: "text";
      filename?: string;
      text: string;
    };

export type TurnSubmitDecision =
  | { type: "empty" }
  | { type: "send"; text: string }
  | { type: "queue"; text: string }
  | { type: "reject"; reason: "attachments-while-busy" };

export function decideTurnSubmit(opts: {
  text: string;
  attachmentCount?: number;
  busy: boolean;
}): TurnSubmitDecision {
  const text = opts.text.trim();
  const n = opts.attachmentCount ?? 0;
  if (!text && n === 0) return { type: "empty" };
  if (opts.busy && n > 0) {
    return { type: "reject", reason: "attachments-while-busy" };
  }
  if (opts.busy) return { type: "queue", text };
  return { type: "send", text };
}

export function classifyAttachments(
  items: readonly TurnAttachment[],
): ClassifiedAttachment[] {
  if (items.length > MAX_ATTACHMENTS) {
    throw new Error(`at most ${MAX_ATTACHMENTS} attachments per turn`);
  }
  return items.map((item) => classifyAttachment(item));
}

export function classifyAttachment(item: TurnAttachment): ClassifiedAttachment {
  const bytes = item.bytes;
  const filename = item.filename?.trim() || undefined;
  const ext = extensionOf(filename);

  if (bytes.byteLength === 0) {
    throw new Error("empty attachment");
  }
  if (ext === "svg" || isSvg(bytes)) {
    throw new Error("svg attachments are not supported");
  }
  if (isZip(bytes)) {
    throw new Error("zip and office archives are not supported");
  }
  if (isOle(bytes)) {
    throw new Error("office documents are not supported");
  }

  const sniffed = sniff(bytes, ext);
  if (filename && ext && IMAGE_EXT[ext] && sniffed.kind === "image") {
    const expected = IMAGE_EXT[ext];
    if (expected && sniffed.mediaType !== expected) {
      throw new Error(
        `magic / extension mismatch: ${filename} is ${sniffed.mediaType}`,
      );
    }
  }
  if (ext === "pdf" && sniffed.kind !== "document") {
    throw new Error(`magic / extension mismatch: ${filename} is not a pdf`);
  }
  if (item.mediaType && sniffed.kind !== "text" && item.mediaType !== sniffed.mediaType) {
    throw new Error(
      `magic / extension mismatch: claimed ${item.mediaType}, got ${sniffed.mediaType}`,
    );
  }

  return sniffed.kind === "text"
    ? { kind: "text", filename, text: sniffed.text }
    : sniffed.kind === "image"
      ? {
          kind: "image",
          mediaType: sniffed.mediaType,
          filename,
          bytes,
        }
      : {
          kind: "document",
          mediaType: "application/pdf",
          filename,
          bytes,
        };
}

export async function readTurnFiles(paths: readonly string[]): Promise<TurnAttachment[]> {
  const out: TurnAttachment[] = [];
  for (const raw of paths) {
    const resolved = path.resolve(raw);
    const buf = await readFile(resolved);
    out.push({
      filename: path.basename(resolved),
      bytes: new Uint8Array(buf),
    });
  }
  return out;
}

function sniff(
  bytes: Uint8Array,
  ext?: string,
):
  | { kind: "image"; mediaType: ImageMediaType }
  | { kind: "document"; mediaType: "application/pdf" }
  | { kind: "text"; text: string } {
  const image = sniffImage(bytes);
  if (image) {
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`image exceeds ${MAX_IMAGE_BYTES} bytes (5 MiB)`);
    }
    return { kind: "image", mediaType: image };
  }
  if (isPdf(bytes)) {
    if (bytes.byteLength > MAX_PDF_BYTES) {
      throw new Error(`pdf exceeds ${MAX_PDF_BYTES} bytes (20 MiB)`);
    }
    return { kind: "document", mediaType: "application/pdf" };
  }
  if (ext && TEXT_EXTENSIONS.has(ext)) {
    if (bytes.byteLength > MAX_TEXT_BYTES) {
      throw new Error(`text attachment exceeds ${MAX_TEXT_BYTES} bytes`);
    }
    return { kind: "text", text: new TextDecoder("utf8").decode(bytes) };
  }
  throw new Error(
    ext
      ? `unsupported attachment type .${ext}`
      : "unsupported attachment type",
  );
}

function sniffImage(bytes: Uint8Array): ImageMediaType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isOle(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  );
}

function isSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf8", { fatal: false })
    .decode(bytes.slice(0, 256))
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<svg")) return true;
  return head.startsWith("<?xml") && head.includes("<svg");
}

function extensionOf(filename?: string): string | undefined {
  if (!filename) return undefined;
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return base.slice(dot + 1).toLowerCase();
}
