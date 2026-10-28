import type { ClientHandshake } from "@min-agent/client";
import {
  attachSession,
  listWorkspaceSessions,
  type AttachedSession,
} from "@min-agent/mind";
import type { TuiArgs } from "./args.js";
import type { SessionListItem } from "./commands.js";

export function permissionModeOf(args: { auto: boolean; yes: boolean }) {
  if (args.auto) return "auto" as const;
  if (args.yes) return "yes" as const;
  return "ask" as const;
}

export async function attachTuiSession(
  args: TuiArgs,
  sessionId?: string,
): Promise<AttachedSession> {
  return attachSession({
    cwd: args.cwd,
    provider: args.provider,
    model: args.model,
    sessionId,
    permissionMode: permissionModeOf(args),
    autoApprove: args.yes || args.auto,
    noTools: args.noTools,
  });
}

export async function listTuiSessions(cwd: string): Promise<SessionListItem[]> {
  const listed = await listWorkspaceSessions(cwd);
  const map = new Map<string, SessionListItem>();
  for (const meta of listed.history) {
    map.set(meta.id, {
      id: meta.id,
      title: meta.title,
      updatedAt: meta.updatedAt,
    });
  }
  for (const live of listed.live) {
    if (!map.has(live.sessionId)) {
      map.set(live.sessionId, {
        id: live.sessionId,
        title: "(live)",
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type { AttachedSession, ClientHandshake };
