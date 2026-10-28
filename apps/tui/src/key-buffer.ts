/**
 * Assemble possibly-split terminal key sequences before decoding.
 *
 * Raw stdin may deliver `\x1b` and `[27;2;13~` in separate readable()
 * ticks. Without buffering, the leading ESC is treated as Escape and the
 * rest becomes garbage — so Shift+Enter never becomes a newline.
 */

export type KeyBufferFlush = (sequence: string) => void;

const ESC_TIMEOUT_MS = 35;

/** True when `buf` is a prefix of a known multi-byte key sequence. */
export function isIncompleteKeySequence(buf: string): boolean {
  if (!buf) return false;
  if (buf === "\x1b") return true;
  if (buf === "\x1b\x1b") return true;
  if (buf === "\x1b[") return true;
  if (buf === "\x1bO") return true;
  if (buf === "\x1b[200~") return true; // bracketed paste start alone
  // CSI / SS3 still open: ESC [ ... (no final byte yet)
  if (/^\x1b\[[0-9;?]*$/.test(buf)) return true;
  if (/^\x1bO[0-9;]*$/.test(buf)) return true;
  // Bracketed paste body not closed
  if (buf.startsWith("\x1b[200~") && !buf.includes("\x1b[201~")) return true;
  return false;
}

/** Pull one complete sequence from the front of `buf`, or null if incomplete. */
export function takeCompleteSequence(buf: string): { sequence: string; rest: string } | null {
  if (!buf) return null;

  // Bracketed paste (complete)
  if (buf.startsWith("\x1b[200~")) {
    const end = buf.indexOf("\x1b[201~");
    if (end === -1) return null;
    const sequence = buf.slice(0, end + "\x1b[201~".length);
    return { sequence, rest: buf.slice(sequence.length) };
  }

  if (buf[0] !== "\x1b") {
    // Paste / burst of printable chars — take the whole non-ESC run.
    const esc = buf.indexOf("\x1b");
    if (esc === -1) return { sequence: buf, rest: "" };
    if (esc === 0) return null;
    return { sequence: buf.slice(0, esc), rest: buf.slice(esc) };
  }

  if (isIncompleteKeySequence(buf)) return null;

  // Complete ESC sequence: longest incomplete prefix + one more byte, or known finals.
  // CSI: ESC [ params final   final = @A-Z\\^_`a-z{|}~
  const csi = /^\x1b\[[0-9;?]*[@-~]/.exec(buf);
  if (csi) {
    const sequence = csi[0]!;
    return { sequence, rest: buf.slice(sequence.length) };
  }
  // SS3: ESC O final
  const ss3 = /^\x1bO[A-Z~]/.exec(buf);
  if (ss3) {
    const sequence = ss3[0]!;
    return { sequence, rest: buf.slice(sequence.length) };
  }
  // Meta + key: ESC <char>
  if (buf.length >= 2 && buf[0] === "\x1b") {
    return { sequence: buf.slice(0, 2), rest: buf.slice(2) };
  }
  // Lone ESC (caller should only reach here after timeout)
  return { sequence: "\x1b", rest: buf.slice(1) };
}

export function createKeyBuffer(flush: KeyBufferFlush, escTimeoutMs = ESC_TIMEOUT_MS) {
  let buf = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const drain = (allowBareEsc: boolean) => {
    for (;;) {
      if (!buf) return;
      if (!allowBareEsc && (buf === "\x1b" || isIncompleteKeySequence(buf))) return;
      const taken = takeCompleteSequence(buf);
      if (!taken) {
        // Incomplete multi-byte — wait unless we're forcing a bare ESC flush.
        if (allowBareEsc && buf.startsWith("\x1b")) {
          flush("\x1b");
          buf = buf.slice(1);
          continue;
        }
        return;
      }
      flush(taken.sequence);
      buf = taken.rest;
    }
  };

  const scheduleEsc = () => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      drain(true);
    }, escTimeoutMs);
  };

  return {
    push(chunk: string) {
      if (!chunk) return;
      buf += chunk;
      clearTimer();
      drain(false);
      if (buf && (buf === "\x1b" || isIncompleteKeySequence(buf))) {
        scheduleEsc();
      }
    },
    /** Flush any pending bytes (e.g. on unmount). */
    dispose() {
      clearTimer();
      drain(true);
      if (buf) {
        flush(buf);
        buf = "";
      }
    },
  };
}
