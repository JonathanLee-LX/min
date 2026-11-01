import { createAgent, mockProvider, userMessage } from "@min-agent/core";
import { describe, expect, it, vi } from "vitest";
import {
  createGzipCodec,
  createR2BindingAdapter,
  jsonCodec,
  r2SyncExtension,
  type SessionBlobStore,
} from "./r2-sync.js";
import { createSession } from "./session.js";
import {
  createMemoryStore,
  type SessionSnapshot,
  type SessionStore,
} from "./store.js";

interface FakeBlob extends SessionBlobStore {
  objects: Map<string, Uint8Array>;
  puts: string[];
  deleted: string[];
}

function fakeBlob(): FakeBlob {
  const objects = new Map<string, Uint8Array>();
  const puts: string[] = [];
  const deleted: string[] = [];
  return {
    objects,
    puts,
    deleted,
    async put(key, body) {
      puts.push(key);
      objects.set(key, body);
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async list(prefix) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
    async delete(key) {
      deleted.push(key);
      objects.delete(key);
    },
  };
}

function snapshot(
  id: string,
  text: string,
  updatedAt = "2024-01-01T00:00:00.000Z",
): SessionSnapshot {
  return {
    meta: { id, createdAt: updatedAt, updatedAt },
    messages: [userMessage(text)],
  };
}

async function newAgent() {
  return createAgent({
    provider: mockProvider([{ text: "ok" }, { text: "ok" }]),
  });
}

describe("r2SyncExtension", () => {
  it("mirrors the snapshot through onBeforeSave and splits meta objects", async () => {
    const blob = fakeBlob();
    const sync = r2SyncExtension({ blob, mode: "await" });
    const agent = await newAgent();
    const session = await createSession({
      agent,
      id: "ses_a",
      store: createMemoryStore(),
      extensions: [sync],
    });

    await session.run("hello");

    expect(blob.puts).toContain("sessions/ses_a.json");
    expect(blob.puts).toContain("sessions/ses_a.meta.json");
    const payload = JSON.parse(
      new TextDecoder().decode(blob.objects.get("sessions/ses_a.json")!),
    ) as SessionSnapshot;
    expect(payload.meta.id).toBe("ses_a");
    expect(payload.messages.at(-1)?.role).toBe("assistant");
    expect(sync.stats.pushed).toBe(1);
  });

  it("does not touch the cloud without a local store (persist short-circuits)", async () => {
    const blob = fakeBlob();
    const sync = r2SyncExtension({ blob, mode: "await" });
    const session = await createSession({
      agent: await newAgent(),
      extensions: [sync],
    });

    await session.run("hello");

    expect(blob.puts).toHaveLength(0);
    expect(sync.stats.pushed).toBe(0);
  });

  it("de-duplicates identical saves by content fingerprint", async () => {
    const blob = fakeBlob();
    const sync = r2SyncExtension({ blob, mode: "await" });
    const snap = snapshot("ses_dup", "same");

    expect(await sync.pushSnapshot(snap)).toBe(true);
    const puts = blob.puts.length;
    expect(await sync.pushSnapshot(snap)).toBe(false);
    expect(blob.puts.length).toBe(puts);
    expect(sync.stats.skipped).toBe(1);

    expect(await sync.pushSnapshot(snapshot("ses_dup", "changed"))).toBe(true);
  });

  it("background mode never blocks the run and flush() drains uploads", async () => {
    const blob = fakeBlob();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: SessionBlobStore = {
      ...blob,
      async put(key, body) {
        await gate;
        await blob.put(key, body);
      },
      async get(key) {
        return blob.get(key);
      },
      async list(prefix) {
        return blob.list(prefix);
      },
    };

    const sync = r2SyncExtension({ blob: slow });
    const session = await createSession({
      agent: await newAgent(),
      id: "ses_bg",
      store: createMemoryStore(),
      extensions: [sync],
    });

    await session.run("hello");
    expect(blob.puts).toHaveLength(0);

    release?.();
    await sync.flush();
    expect(blob.puts).toContain("sessions/ses_bg.json");
  });

  it("swallows cloud errors and reports them instead of failing the run", async () => {
    const onError = vi.fn();
    const boom: SessionBlobStore = {
      async put() {
        throw new Error("r2 down");
      },
      async get() {
        return null;
      },
      async list() {
        return [];
      },
    };
    const sync = r2SyncExtension({ blob: boom, mode: "await", onError });
    const session = await createSession({
      agent: await newAgent(),
      id: "ses_err",
      store: createMemoryStore(),
      extensions: [sync],
    });

    const result = await session.run("hello");

    expect(result.messages.length).toBeGreaterThan(0);
    expect(onError).toHaveBeenCalled();
    expect(sync.stats.failed).toBeGreaterThan(0);
  });

  it("honours shouldSync", async () => {
    const blob = fakeBlob();
    const sync = r2SyncExtension({
      blob,
      mode: "await",
      shouldSync: (snap) => snap.meta.id !== "ses_skip",
    });
    await sync.pushSnapshot(snapshot("ses_skip", "a"));
    expect(blob.puts).toHaveLength(0);
  });

  it("hydrate restores only sessions missing locally", async () => {
    const blob = fakeBlob();
    const writer = r2SyncExtension({ blob, mode: "await" });
    await writer.pushSnapshot(snapshot("ses_1", "one"));
    await writer.pushSnapshot(snapshot("ses_2", "two"));

    const local = createMemoryStore();
    await local.save(snapshot("ses_2", "already here"));

    const reader = r2SyncExtension({ blob });
    const result = await reader.hydrate(local);

    expect(result.restored).toEqual(["ses_1"]);
    expect(result.skipped).toEqual(["ses_2"]);
    expect((await local.load("ses_1"))?.messages).toHaveLength(1);
    expect((await local.load("ses_2"))?.messages[0]?.content[0]).toMatchObject({
      type: "text",
      text: "already here",
    });
  });

  it("hydrate keeps payloads out of the store when dryRun", async () => {
    const blob = fakeBlob();
    const writer = r2SyncExtension({ blob, mode: "await" });
    await writer.pushSnapshot(snapshot("ses_dry", "x"));

    const local = createMemoryStore();
    const result = await r2SyncExtension({ blob }).hydrate(local, {
      dryRun: true,
    });

    expect(result.restored).toEqual(["ses_dry"]);
    expect(await local.load("ses_dry")).toBeNull();
  });

  it("backfill pushes local sessions that the cloud does not have", async () => {
    const blob = fakeBlob();
    const local = createMemoryStore();
    await local.save(snapshot("ses_new", "new", "2024-02-01T00:00:00.000Z"));
    await local.save(snapshot("ses_old", "old", "2024-01-01T00:00:00.000Z"));

    const sync = r2SyncExtension({ blob, mode: "await" });
    await sync.pushSnapshot(
      snapshot("ses_old", "remote newer", "2024-03-01T00:00:00.000Z"),
    );

    const result = await sync.backfill(local);

    expect(result.pushed).toEqual(["ses_new"]);
    expect(result.skipped).toEqual(["ses_old"]);
  });

  it("round-trips through the gzip codec", async () => {
    const blob = fakeBlob();
    const codec = createGzipCodec();
    const sync = r2SyncExtension({ blob, codec, mode: "await" });
    const snap = snapshot("ses_gz", "compress me ".repeat(500));

    await sync.pushSnapshot(snap);
    const raw = blob.objects.get("sessions/ses_gz.json")!;
    expect(raw.byteLength).toBeLessThan(
      new TextEncoder().encode(JSON.stringify(snap)).byteLength,
    );

    const pulled = await sync.pull("ses_gz");
    expect(pulled?.messages[0]).toEqual(snap.messages[0]);
  });

  it("jsonCodec is the default and stays inspectable", async () => {
    const codec = jsonCodec;
    const bytes = await codec.encode(snapshot("ses_plain", "plain"));
    expect(new TextDecoder().decode(bytes)).toContain('"ses_plain"');
    expect((await codec.decode(bytes)).meta.id).toBe("ses_plain");
  });
});

describe("createR2BindingAdapter", () => {
  it("adapts a Workers R2 binding", async () => {
    const objects = new Map<string, Uint8Array>();
    const binding = {
      async put(key: string, value: Uint8Array) {
        objects.set(key, value);
        return {};
      },
      async get(key: string) {
        const hit = objects.get(key);
        return hit
          ? { arrayBuffer: async () => hit.buffer.slice(0) as ArrayBuffer }
          : null;
      },
      async list({ prefix }: { prefix?: string } = {}) {
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix ?? ""));
        return { objects: keys.map((key) => ({ key })), truncated: false };
      },
    };

    const blob = createR2BindingAdapter(binding);
    await blob.put("sessions/a.json", new Uint8Array([1, 2, 3]));
    expect(await blob.list("sessions/")).toEqual(["sessions/a.json"]);
    expect([...(await blob.get("sessions/a.json"))!]).toEqual([1, 2, 3]);
    expect(await blob.get("sessions/missing.json")).toBeNull();
  });
});

describe("r2SyncExtension with a session store round-trip", () => {
  it("a restored session continues from remote history", async () => {
    const blob = fakeBlob();
    const remoteStore: SessionStore = createMemoryStore();

    const writer = await createSession({
      agent: await newAgent(),
      id: "ses_round",
      store: remoteStore,
      extensions: [r2SyncExtension({ blob, mode: "await" })],
    });
    await writer.run("first turn");

    const local = createMemoryStore();
    await r2SyncExtension({ blob }).hydrate(local);

    const reader = await createSession({
      agent: await newAgent(),
      id: "ses_round",
      store: local,
    });
    expect(reader.messages.length).toBeGreaterThan(0);
  });
});
