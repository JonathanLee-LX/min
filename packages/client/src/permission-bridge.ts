import type { PermissionAskResult, ToolCallPart } from "@min/core";

export interface PendingPermission {
  id: string;
  toolCall: ToolCallPart;
  reason: string;
  grantRoot?: string;
  resolve: (answer: PermissionAskResult) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface PermissionBridge {
  ask(req: {
    toolCall: ToolCallPart;
    reason: string;
    grantRoot?: string;
  }): Promise<PermissionAskResult>;
  respond(id: string, answer: PermissionAskResult): boolean;
  /** Deny all outstanding asks (dispose / abort). */
  rejectAll(answer?: PermissionAskResult): void;
  readonly size: number;
}

export function createPermissionBridge(opts: {
  timeoutMs: number;
  onAsk: (pending: Omit<PendingPermission, "resolve" | "timer">) => void;
}): PermissionBridge {
  const pending = new Map<string, PendingPermission>();
  let seq = 0;

  return {
    get size() {
      return pending.size;
    },

    ask(req) {
      const id = `perm_${++seq}`;
      return new Promise<PermissionAskResult>((resolve) => {
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
  };
}
