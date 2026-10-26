import type { Message, ModelProvider } from "@min-agent/core";

const SLOT = Symbol.for("@min-agent/session.projection");

export type MessageProjector = (
  messages: readonly Message[],
) => Message[] | Promise<Message[]>;

interface ProjectionSlot {
  current?: MessageProjector;
}

/**
 * Replace `complete` / `stream` so a host can swap the model view per call.
 * The inner provider still sees one request; canonical history stays with the caller.
 */
export function attachMessageProjection(provider: ModelProvider): {
  set(project: MessageProjector | undefined): void;
} {
  const tagged = provider as ModelProvider & { [SLOT]?: ProjectionSlot };
  if (tagged[SLOT]) {
    const existing = tagged[SLOT];
    return {
      set(project) {
        existing.current = project;
      },
    };
  }

  const slot: ProjectionSlot = {};
  tagged[SLOT] = slot;
  const originalComplete = provider.complete.bind(provider);
  const originalStream = provider.stream?.bind(provider);

  provider.complete = async (req) => {
    const messages = slot.current ? await slot.current(req.messages) : req.messages;
    return originalComplete({ ...req, messages: [...messages] });
  };
  if (originalStream) {
    provider.stream = async function* (req) {
      const messages = slot.current
        ? await slot.current(req.messages)
        : req.messages;
      yield* originalStream({ ...req, messages: [...messages] });
    };
  }

  return {
    set(project) {
      slot.current = project;
    },
  };
}
