/**
 * Process-wide notice log.
 *
 * Producers (config, and later other subsystems) call {@link noticeLog.record}.
 * `@min-agent/client` exposes the same log to views. Views do not read it directly.
 */

export interface Notice {
  id: number;
  level: "info" | "warning";
  source: string;
  message: string;
}

export interface NoticeInput {
  level?: Notice["level"];
  source: string;
  message: string;
}

export interface NoticeLog {
  record(input: NoticeInput): Notice | undefined;
  list(): readonly Notice[];
  subscribe(handler: (notice: Notice) => void): () => void;
  clear(): void;
}

export function createNoticeLog(): NoticeLog {
  const items: Notice[] = [];
  const listeners = new Set<(notice: Notice) => void>();
  let nextId = 1;

  return {
    record(input) {
      const message = input.message.trim();
      const source = input.source.trim();
      if (!message || !source) return undefined;
      const notice: Notice = {
        id: nextId,
        level: input.level ?? "info",
        source,
        message,
      };
      nextId += 1;
      items.push(notice);
      for (const listener of listeners) listener(notice);
      return notice;
    },
    list() {
      return items.slice();
    },
    subscribe(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    clear() {
      items.length = 0;
      nextId = 1;
    },
  };
}

/** Shared log for this process. */
export const noticeLog = createNoticeLog();
