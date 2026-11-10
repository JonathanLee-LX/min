import { classifyAttachment, decideTurnSubmit } from "@min-agent/client";
import type { TurnAttachment } from "@min-agent/client";
import { randomBytes } from "node:crypto";

export interface StagedAttachment {
  id: string;
  filename: string;
  mediaType: string;
  byteLength: number;
  bytes: Uint8Array;
}

const staged = new Map<string, StagedAttachment>();

export function stageBytes(input: {
  filename?: string;
  mediaType?: string;
  bytes: Uint8Array;
}): Omit<StagedAttachment, "bytes"> {
  const classified = classifyAttachment({
    filename: input.filename,
    mediaType: input.mediaType,
    bytes: input.bytes,
  });
  const id = `stg_${randomBytes(8).toString("hex")}`;
  const filename = input.filename?.trim() || "upload";
  const mediaType =
    classified.kind === "text"
      ? "text/plain"
      : classified.kind === "image"
        ? classified.mediaType
        : "application/pdf";
  staged.set(id, {
    id,
    filename,
    mediaType,
    byteLength: input.bytes.byteLength,
    bytes: input.bytes,
  });
  return { id, filename, mediaType, byteLength: input.bytes.byteLength };
}

export function takeStaged(ids: readonly string[]): TurnAttachment[] {
  const out: TurnAttachment[] = [];
  for (const id of ids) {
    const hit = staged.get(id);
    if (!hit) throw new Error(`unknown attachment ${id}`);
    staged.delete(id);
    out.push({
      filename: hit.filename,
      mediaType: hit.mediaType,
      bytes: hit.bytes,
    });
  }
  return out;
}

export function peekStaged(id: string): StagedAttachment | undefined {
  return staged.get(id);
}

export function hasStaged(id: string): boolean {
  return staged.has(id);
}

export type ResolvedTurnSubmit =
  | { type: "empty" }
  | { type: "queue"; text: string }
  | { type: "reject"; reason: "attachments-while-busy" }
  | { type: "send"; text: string; attachments: TurnAttachment[] }
  | { type: "unknown"; error: string };

/**
 * Consume staging only on the send path. Busy+attachments reject
 * before takeStaged; plain-text busy still queues.
 */
export function resolveTurnSubmit(opts: {
  text: string;
  attachmentIds: readonly string[];
  busy: boolean;
}): ResolvedTurnSubmit {
  const decision = decideTurnSubmit({
    text: opts.text,
    attachmentCount: opts.attachmentIds.length,
    busy: opts.busy,
  });
  if (decision.type !== "send") return decision;
  try {
    return {
      type: "send",
      text: decision.text,
      attachments: takeStaged(opts.attachmentIds),
    };
  } catch (err) {
    return {
      type: "unknown",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
