import type { Message, RunResult, ToolDefinition } from "@min/core";
import type {
  AssembleInput,
  AssembleResult,
} from "./assemble.js";
import type { SessionMeta, SessionSnapshot } from "./store.js";

/**
 * Pluggable strategy for building the model view.
 * Defaults / factories live in `strategies.ts`
 * (`createTrimAssembler`, `createHmtAssembler`, `hmtContextExtension`).
 */
export interface ContextAssembler {
  assemble(
    input: AssembleInput,
  ): AssembleResult | Promise<AssembleResult>;
}

export interface SessionHookContext {
  sessionId: string;
  meta: SessionMeta;
  /** Canonical history before this user turn is appended. */
  messages: readonly Message[];
  input: string;
  system?: string;
  tools: ToolDefinition[];
}

export interface SessionHooks {
  onBeforeRun?: (ctx: SessionHookContext) => void | Promise<void>;
  /**
   * After the assembler runs. Return a new AssembleResult to replace the view.
   */
  onAfterAssemble?: (
    ctx: SessionHookContext & {
      pending: Message[];
      assemble: AssembleResult;
    },
  ) => AssembleResult | void | Promise<AssembleResult | void>;
  onAfterRun?: (
    ctx: SessionHookContext & {
      assemble: AssembleResult;
      result: RunResult;
      /** Canonical history that will be stored after this run. */
      nextMessages: Message[];
    },
  ) => void | Promise<void>;
  /**
   * Fired when the session drains follow-ups from the input queue
   * before starting another agent pass (does not modify `@min/core`).
   */
  onIncoming?: (texts: string[]) => void | Promise<void>;
  /**
   * Transform snapshot before persist. Return a snapshot to save, or void to keep.
   */
  onBeforeSave?: (
    snapshot: SessionSnapshot,
  ) => SessionSnapshot | void | Promise<SessionSnapshot | void>;
}

/**
 * Packaged session extension — compose assembler and/or hooks without
 * bloating the Session kernel.
 */
export interface SessionExtension {
  name: string;
  assembler?: ContextAssembler;
  hooks?: SessionHooks;
}

export function defineSessionExtension(
  ext: SessionExtension,
): SessionExtension {
  return ext;
}

/** Merge extensions left-to-right; later assembler wins; hooks run in order. */
export function resolveSessionExtensions(
  extensions: SessionExtension[] | undefined,
  fallbackAssembler: ContextAssembler,
): { assembler: ContextAssembler; hooks: SessionHooks[] } {
  const hooks: SessionHooks[] = [];
  let assembler = fallbackAssembler;
  for (const ext of extensions ?? []) {
    if (ext.assembler) assembler = ext.assembler;
    if (ext.hooks) hooks.push(ext.hooks);
  }
  return { assembler, hooks };
}

export async function runHookList<T>(
  hooks: SessionHooks[],
  pick: (h: SessionHooks) => ((arg: T) => unknown) | undefined,
  arg: T,
): Promise<void> {
  for (const h of hooks) {
    const fn = pick(h);
    if (fn) await fn(arg);
  }
}
