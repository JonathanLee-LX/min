export { attachSession, listWorkspaceSessions, type AttachSessionOptions, type AttachedSession } from "./attach.js";
export { connectClientProcess, type RemoteClient } from "./client-socket.js";
export { listenClientProcess, type ClientProcessServer } from "./client-server.js";
export {
  ensureMind,
  mindCreate,
  mindDestroy,
  mindList,
  mindLookup,
  openLease,
  waitForMind,
  type MindConnection,
} from "./connect.js";
export { startMindDaemon, type MindDaemon, type MindDaemonOptions } from "./daemon.js";
export { isPidAlive } from "./ipc.js";
export { existingMind } from "./lock.js";
export {
  CREATE_TIMEOUT_MS_DEFAULT,
  DESTROY_WAIT_MS_DEFAULT,
  DRAIN_GRACE_MS_DEFAULT,
  clientSocketPath,
  mindPaths,
  mindRoot,
} from "./paths.js";
export type {
  ClientRecord,
  LiveClientInfo,
  MindHello,
  MindListResult,
  PermissionMode,
} from "./protocol.js";
export {
  claimRecords,
  readClientRecord,
  removeClientRecord,
  writeClientRecord,
} from "./registry.js";
export { MIND_PROTOCOL, mindBuildVersion } from "./version.js";
