/**
 * Cloudflare R2 (S3-compatible object storage) mirroring as a **SessionExtension**.
 *
 * - Writes go through `onBeforeSave` — the only hook that runs inside
 *   `persist()` and therefore the only place that sees the exact snapshot
 *   that is about to hit the local store (`run` / `compact` / `dispose`).
 * - Reads cannot be hooked (Session only calls `store.load`), so remote →
 *   local restore is an explicit `hydrate(store)` call made *before*
 *   `createSession`.
 * - Cloud failures never escape into `session.run()`; they surface via
 *   `onError` and `sync.stats.failed`.
 *
 * Zero Node-only dependencies: object I/O is abstracted behind
 * `SessionBlobStore`, so the same extension runs on Node
 * (`@aws-sdk/client-s3`) and on Cloudflare Workers (R2 binding).
 */

import { defineSessionExtension, type SessionExtension } from "./extension.js";
import type { SessionSnapshot, SessionStore } from "./store.js";

export interface SessionBlobPutOptions {
  contentType?: string;
  contentEncoding?: string;
}

/**
 * Minimal object-store surface. `@aws-sdk/client-s3`, R2 bindings and
 * `aws4fetch` all adapt to this in a few lines.
 */
export interface SessionBlobStore {
  put(
    key: string,
    body: Uint8Array,
    opts?: SessionBlobPutOptions,
  ): Promise<void>;
  /** `null` when the key does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  /** All keys under `prefix` (implementations may page internally). */
  list(prefix: string): Promise<string[]>;
  delete?(key: string): Promise<void>;
}

export interface BlobCodec {
  contentType: string;
  contentEncoding?: string;
  encode(snapshot: SessionSnapshot): Uint8Array | Promise<Uint8Array>;
  decode(bytes: Uint8Array): SessionSnapshot | Promise<SessionSnapshot>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Plain UTF-8 JSON. Human-inspectable in the R2 dashboard. Default. */
export const jsonCodec: BlobCodec = {
  contentType: "application/json",
  encode(snapshot) {
    return encoder.encode(JSON.stringify(snapshot));
  },
  decode(bytes) {
    return JSON.parse(decoder.decode(bytes)) as SessionSnapshot;
  },
};

type AnyStream = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

function streamCtor(
  name: "CompressionStream" | "DecompressionStream",
): (new (format: "gzip") => AnyStream) | undefined {
  const ctor = (globalThis as Record<string, unknown>)[name];
  return typeof ctor === "function"
    ? (ctor as new (format: "gzip") => AnyStream)
    : undefined;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const Ctor = streamCtor("CompressionStream");
  if (!Ctor) {
    throw new Error(
      "gzip codec needs CompressionStream (Node >= 18 / Workers)",
    );
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new Ctor("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const Ctor = streamCtor("DecompressionStream");
  if (!Ctor) {
    throw new Error(
      "gzip codec needs DecompressionStream (Node >= 18 / Workers)",
    );
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new Ctor("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** gzip-compressed JSON. Roughly 5–10x smaller for tool-heavy sessions. */
export function createGzipCodec(): BlobCodec {
  return {
    contentType: "application/json",
    contentEncoding: "gzip",
    async encode(snapshot) {
      return gzip(encoder.encode(JSON.stringify(snapshot)));
    },
    async decode(bytes) {
      return JSON.parse(decoder.decode(await gunzip(bytes))) as SessionSnapshot;
    },
  };
}

/** Adapter for a Cloudflare Workers R2 binding (`env.MY_BUCKET`). */
export function createR2BindingAdapter(bucket: {
  put(
    key: string,
    value: Uint8Array,
    opts?: { httpMetadata?: { contentType?: string; contentEncoding?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  list(opts?: { prefix?: string; cursor?: string }): Promise<{
    objects: { key: string }[];
    truncated?: boolean;
    cursor?: string;
  }>;
  delete?(key: string): Promise<unknown>;
}): SessionBlobStore {
  return {
    async put(key, body, opts) {
      await bucket.put(key, body, {
        httpMetadata: {
          contentType: opts?.contentType,
          contentEncoding: opts?.contentEncoding,
        },
      });
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      return new Uint8Array(await obj.arrayBuffer());
    },
    async list(prefix) {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix, cursor });
        for (const o of page.objects) keys.push(o.key);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return keys;
    },
    ...(bucket.delete
      ? {
          async delete(key: string) {
            await bucket.delete?.(key);
          },
        }
      : {}),
  };
}

export interface R2SyncErrorInfo {
  phase: "push" | "pull" | "list";
  sessionId?: string;
  key?: string;
}

export interface R2SyncStats {
  pushed: number;
  skipped: number;
  failed: number;
  pulled: number;
}

export interface R2SyncOptions {
  /** Object store adapter (`createR2BindingAdapter` or an S3 SDK wrapper). */
  blob: SessionBlobStore;
  /** Key prefix. Default `sessions/`. */
  prefix?: string;
  /** Serialization. Default `jsonCodec`. */
  codec?: BlobCodec;
  /**
   * `background` (default) resolves the hook immediately and uploads in the
   * background — a run never waits on the network. `await` blocks
   * `persist()` until the push lands (strong consistency, slower runs).
   */
  mode?: "await" | "background";
  /** Skip snapshots you do not want in the cloud (e.g. throwaway REPL runs). */
  shouldSync?: (snapshot: SessionSnapshot) => boolean;
  /** Write `<id>.meta.json` alongside the payload so `list` stays cheap. */
  metaObjects?: boolean;
  onError?: (err: unknown, info: R2SyncErrorInfo) => void;
}

export interface R2SyncHydrateOptions {
  /** Restrict to these session ids (default: everything under `prefix`). */
  ids?: string[];
  /** Only report what would be restored. */
  dryRun?: boolean;
}

export interface R2SyncHydrateResult {
  /** Ids that were pulled and written into the local store. */
  restored: string[];
  /** Ids already present locally. */
  skipped: string[];
  failed: { id: string; error: unknown }[];
}

export interface R2SyncExtension extends SessionExtension {
  readonly prefix: string;
  readonly stats: Readonly<R2SyncStats>;
  /** Await in-flight background uploads. Call before process exit. */
  flush(): Promise<void>;
  /** Fetch a single snapshot from the cloud (no local write). */
  pull(id: string): Promise<SessionSnapshot | null>;
  /** Mirror a snapshot out-of-band (backfill / migration). */
  pushSnapshot(snapshot: SessionSnapshot): Promise<boolean>;
  /** Pull remote snapshots into a local store. Run before `createSession`. */
  hydrate(
    store: SessionStore,
    opts?: R2SyncHydrateOptions,
  ): Promise<R2SyncHydrateResult>;
  /** Push every local snapshot that the cloud is missing or older than. */
  backfill(store: SessionStore): Promise<{ pushed: string[]; skipped: string[] }>;
}

const DATA_SUFFIX = ".json";
const META_SUFFIX = ".meta.json";

function dataKey(prefix: string, id: string): string {
  return `${prefix}${id}${DATA_SUFFIX}`;
}

function metaKey(prefix: string, id: string): string {
  return `${prefix}${id}${META_SUFFIX}`;
}

function idFromKey(prefix: string, key: string): string | undefined {
  if (!key.startsWith(prefix) || !key.endsWith(DATA_SUFFIX)) return undefined;
  if (key.endsWith(META_SUFFIX)) return undefined;
  const id = key.slice(prefix.length, key.length - DATA_SUFFIX.length);
  return id.length ? id : undefined;
}

/** FNV-1a — cheap content fingerprint for de-duplicating identical saves. */
function fingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}:${bytes.length}`;
}

export function r2SyncExtension(opts: R2SyncOptions): R2SyncExtension {
  const prefix = opts.prefix ?? "sessions/";
  const codec = opts.codec ?? jsonCodec;
  const mode = opts.mode ?? "background";
  const metaObjects = opts.metaObjects ?? true;

  const inFlight = new Set<Promise<unknown>>();
  const fingerprints = new Map<string, string>();
  const stats: R2SyncStats = { pushed: 0, skipped: 0, failed: 0, pulled: 0 };

  const track = (job: Promise<unknown>) => {
    inFlight.add(job);
    void job.finally(() => inFlight.delete(job));
  };

  const upload = async (snapshot: SessionSnapshot): Promise<boolean> => {
    if (opts.shouldSync && !opts.shouldSync(snapshot)) {
      stats.skipped++;
      return false;
    }
    const id = snapshot.meta.id;
    const key = dataKey(prefix, id);
    const body = await codec.encode(snapshot);
    const print = fingerprint(body);
    if (fingerprints.get(id) === print) {
      stats.skipped++;
      return false;
    }
    await opts.blob.put(key, body, {
      contentType: codec.contentType,
      contentEncoding: codec.contentEncoding,
    });
    if (metaObjects) {
      await opts.blob.put(
        metaKey(prefix, id),
        encoder.encode(JSON.stringify(snapshot.meta)),
        { contentType: "application/json" },
      );
    }
    fingerprints.set(id, print);
    stats.pushed++;
    return true;
  };

  const report = (err: unknown, info: R2SyncErrorInfo) => {
    stats.failed++;
    opts.onError?.(err, info);
  };

  const { hooks } = defineSessionExtension({
    name: "r2-sync",
    hooks: {
      onBeforeSave(snapshot) {
        const job = upload(snapshot).catch((err) =>
          report(err, { phase: "push", sessionId: snapshot.meta.id }),
        );
        if (mode === "await") return job.then(() => undefined);
        track(job);
        return undefined;
      },
    },
  });

  const pull = async (id: string): Promise<SessionSnapshot | null> => {
    try {
      const bytes = await opts.blob.get(dataKey(prefix, id));
      if (!bytes) return null;
      stats.pulled++;
      return await codec.decode(bytes);
    } catch (err) {
      report(err, { phase: "pull", sessionId: id });
      return null;
    }
  };

  const pushSnapshot = async (
    snapshot: SessionSnapshot,
  ): Promise<boolean> => {
    try {
      return await upload(snapshot);
    } catch (err) {
      report(err, { phase: "push", sessionId: snapshot.meta.id });
      return false;
    }
  };

  return {
    name: "r2-sync",
    hooks,
    prefix,
    get stats() {
      return stats;
    },

    async flush() {
      await Promise.allSettled([...inFlight]);
    },

    pull,

    pushSnapshot,

    async hydrate(store, hydrateOpts = {}) {
      const result: R2SyncHydrateResult = {
        restored: [],
        skipped: [],
        failed: [],
      };

      let ids: string[] = hydrateOpts.ids ? [...hydrateOpts.ids] : [];
      if (!hydrateOpts.ids) {
        try {
          const keys = await opts.blob.list(prefix);
          ids = keys
            .map((key) => idFromKey(prefix, key))
            .filter((id): id is string => !!id);
        } catch (err) {
          report(err, { phase: "list" });
          return result;
        }
      }

      for (const id of ids) {
        try {
          if (await store.load(id)) {
            result.skipped.push(id);
            continue;
          }
          const snapshot = await pull(id);
          if (!snapshot) {
            result.skipped.push(id);
            continue;
          }
          if (!hydrateOpts.dryRun) await store.save(snapshot);
          result.restored.push(id);
        } catch (err) {
          report(err, { phase: "pull", sessionId: id });
          result.failed.push({ id, error: err });
        }
      }

      return result;
    },

    async backfill(store) {
      const pushed: string[] = [];
      const skipped: string[] = [];
      for (const meta of await store.list()) {
        const snapshot = await store.load(meta.id);
        if (!snapshot) {
          skipped.push(meta.id);
          continue;
        }
        const remote = await pull(meta.id);
        if (remote && remote.meta.updatedAt >= snapshot.meta.updatedAt) {
          skipped.push(meta.id);
          continue;
        }
        if (await pushSnapshot(snapshot)) pushed.push(meta.id);
        else skipped.push(meta.id);
      }
      return { pushed, skipped };
    },
  };
}
