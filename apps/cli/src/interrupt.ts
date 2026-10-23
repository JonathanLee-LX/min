/** True for AbortError / DOMException abort from AbortSignal. */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: string; message?: string };
  return (
    e.name === "AbortError" ||
    e.code === "ABORT_ERR" ||
    (typeof e.message === "string" && /aborted/i.test(e.message))
  );
}

/**
 * Run `fn` with an AbortSignal aborted on Ctrl+C (SIGINT).
 * Nested calls share the outer controller if one is already active.
 */
export async function withSigintAbort<T>(
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ac = new AbortController();
  let armed = true;

  const onSigInt = () => {
    if (!armed || ac.signal.aborted) return;
    ac.abort();
    process.stderr.write("\n^C interrupted\n");
  };

  process.on("SIGINT", onSigInt);
  try {
    return await fn(ac.signal);
  } finally {
    armed = false;
    process.off("SIGINT", onSigInt);
  }
}
