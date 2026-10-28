import type { ToolCallPart } from "@min-agent/core";
import type { PermissionAnswer } from "./types.js";

export interface PendingPermission {
  id: string;
  toolCall: ToolCallPart;
  reason: string;
  grantRoot?: string;
  resolve: (answer: PermissionAnswer) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface PermissionBridge {
  ask(req: {
    toolCall: ToolCallPart;
    reason: string;
    grantRoot?: string;
  }): Promise<PermissionAnswer>;
  respond(id: string, answer: PermissionAnswer): boolean;
  /** Deny all outstanding asks (dispose / abort). */
  rejectAll(answer?: PermissionAnswer): void;
  /** Outstanding asks, oldest first. */
  list(): Array<Omit<PendingPermission, "resolve" | "timer">>;
  readonly size: number;
}

export function createPermissionBridge(opts: {
  timeoutMs: number;
  onAsk: (pending: Omit<PendingPermission, "resolve" | "timer">) => void;
  /** Fired once when an outstanding ask is actually resolved. */
  onDecision?: (id: string, answer: PermissionAnswer) => void;
}): PermissionBridge {
  const pending = new Map<string, PendingPermission>();
  let seq = 0;

  return {
    get size() {
      return pending.size;
    },

    ask(req) {
      const id = `perm_${++seq}`;
      return new Promise<PermissionAnswer>((resolve) => {
        const entry: PendingPermission = {
          id,
          toolCall: req.toolCall,
          reason: req.reason,
          grantRoot: req.grantRoot,
          resolve: (answer) => {
            const hit = pending.get(id);
            if (!hit) return;
            if (hit.timer) clearTimeout(hit.timer);
            pending.delete(id);
            opts.onDecision?.(id, answer);
            resolve(answer);
          },
        };

        if (opts.timeoutMs > 0) {
          entry.timer = setTimeout(() => {
            entry.resolve("deny");
          }, opts.timeoutMs);
        }

        pending.set(id, entry);
        opts.onAsk({
          id,
          toolCall: req.toolCall,
          reason: req.reason,
          grantRoot: req.grantRoot,
        });
      });
    },

    respond(id, answer) {
      const hit = pending.get(id);
      if (!hit) return false;
      hit.resolve(answer);
      return true;
    },

    rejectAll(answer = "deny") {
      for (const entry of [...pending.values()]) {
        entry.resolve(answer);
      }
    },

    list() {
      return [...pending.values()].map((entry) => ({
        id: entry.id,
        toolCall: entry.toolCall,
        reason: entry.reason,
        grantRoot: entry.grantRoot,
      }));
    },
  };
}
