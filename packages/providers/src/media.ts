import type { ContentPart, DocumentPart, ImagePart, Message } from "@min-agent/core";

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function toDataUrl(mediaType: string, bytes: Uint8Array): string {
  return `data:${mediaType};base64,${bytesToBase64(bytes)}`;
}

export function requireMediaData(
  part: ImagePart | DocumentPart,
): Uint8Array {
  if (!part.data || part.data.byteLength === 0) {
    throw new Error(`unhydrated ${part.type} part`);
  }
  return part.data;
}

export function findMediaParts(messages: readonly Message[]): ContentPart[] {
  return messages.flatMap((message) =>
    message.content.filter(
      (part) => part.type === "image" || part.type === "document",
    ),
  );
}

export function rejectMedia(
  messages: readonly Message[],
  label: string,
): void {
  const hit = findMediaParts(messages)[0];
  if (!hit) return;
  throw new Error(`${label} does not accept ${hit.type} parts`);
}
