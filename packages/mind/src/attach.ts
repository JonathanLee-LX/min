import type { ClientHandshake, MinClient } from "@min-agent/client";
import { connectClientProcess, type RemoteClient } from "./client-socket.js";
import { mindCreate, mindList, openLease } from "./connect.js";
import type { MindListResult, PermissionMode } from "./protocol.js";

export interface AttachSessionOptions {
  cwd: string;
  provider?: string;
  model?: string;
  sessionId?: string;
  autoApprove?: boolean;
  permissionMode?: PermissionMode;
  noTools?: boolean;
  root?: string;
}

export interface AttachedSession {
  sessionId: string;
  address: string;
  client: MinClient;
  remote: RemoteClient;
  handshake: ClientHandshake;
  release(): Promise<void>;
}

export async function attachSession(opts: AttachSessionOptions): Promise<AttachedSession> {
  const created = await mindCreate(
    {
      op: "create",
      cwd: opts.cwd,
      provider: opts.provider,
      model: opts.model,
      sessionId: opts.sessionId,
      autoApprove: opts.autoApprove,
      permissionMode: opts.permissionMode,
      noTools: opts.noTools,
    },
    opts.root,
  );
  const lease = await openLease(created.sessionId, opts.root);
  const remote = await connectClientProcess(created.address);
  return {
    sessionId: created.sessionId,
    address: created.address,
    client: remote,
    remote,
    handshake: remote.handshake,
    async release() {
      await remote.dispose();
      lease.release();
    },
  };
}

export async function listWorkspaceSessions(
  cwd: string,
  root?: string,
): Promise<MindListResult> {
  return mindList(cwd, root);
}
