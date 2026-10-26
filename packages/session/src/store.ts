import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { Message } from "@min-agent/core";

export interface SessionMeta {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSnapshot {
  meta: SessionMeta;
  messages: Message[];
}

export interface SessionStore {
  save(snapshot: SessionSnapshot): Promise<void>;
  load(id: string): Promise<SessionSnapshot | null>;
  list(): Promise<SessionMeta[]>;
  delete(id: string): Promise<void>;
}

export function createMemoryStore(): SessionStore {
  const map = new Map<string, SessionSnapshot>();
  return {
    async save(snapshot) {
      map.set(snapshot.meta.id, structuredClone(snapshot));
    },
    async load(id) {
      const hit = map.get(id);
      return hit ? structuredClone(hit) : null;
    },
    async list() {
      return [...map.values()]
        .map((s) => s.meta)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async delete(id) {
      map.delete(id);
    },
  };
}

export function createFsStore(dir: string): SessionStore {
  const root = path.resolve(dir);

  const fileFor = (id: string) => {
    if (!/^[\w.-]+$/.test(id)) {
      throw new Error(`Invalid session id: ${id}`);
    }
    return path.join(root, `${id}.json`);
  };

  return {
    async save(snapshot) {
      await mkdir(root, { recursive: true });
      const file = fileFor(snapshot.meta.id);
      await writeFile(file, JSON.stringify(snapshot, null, 2), "utf8");
    },
    async load(id) {
      try {
        const raw = await readFile(fileFor(id), "utf8");
        return JSON.parse(raw) as SessionSnapshot;
      } catch {
        return null;
      }
    },
    async list() {
      try {
        await mkdir(root, { recursive: true });
        const names = await readdir(root);
        const metas: SessionMeta[] = [];
        for (const name of names) {
          if (!name.endsWith(".json")) continue;
          const raw = await readFile(path.join(root, name), "utf8");
          const snap = JSON.parse(raw) as SessionSnapshot;
          metas.push(snap.meta);
        }
        return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      } catch {
        return [];
      }
    },
    async delete(id) {
      try {
        await unlink(fileFor(id));
      } catch {
        // ignore missing
      }
    },
  };
}

export function newSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `ses_${ts}_${rand}`;
}
