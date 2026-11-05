import { inputAction, type InputAction, type InputKey } from "./editor.js";
import { DEFAULT_KEYBINDINGS, type KeybindingTable } from "./keybindings.js";

/**
 * Turn one raw stdin chunk into the editor action.
 *
 * The Backspace key (删除键) sends DEL (`\x7f`) on macOS, Linux, and Windows
 * Terminal. Ink's `useInput` labels that byte `delete`, which is forward
 * delete, so a press at the end of the line removes nothing. Forward delete
 * is the separate sequence `\x1b[3~`.
 */
export function actionFromChunk(
  chunk: string,
  bindings: KeybindingTable = DEFAULT_KEYBINDINGS,
): InputAction {
  const decoded = decodeInput(chunk);
  return inputAction(decoded.input, decoded.key, bindings);
}

/**
 * stdin is a byte stream: a terminal may split one escape sequence across
 * multiple `data` events. Keep an unfinished escape sequence until its final
 * byte arrives so PageUp/PageDown do not turn into ignored editor input.
 */
export function createInputDecoder(): {
  push(chunk: string): Array<{ input: string; key: InputKey }>;
  reset(): void;
} {
  let pending = "";
  return {
    push(chunk) {
      pending += chunk;
      const decoded: Array<{ input: string; key: InputKey }> = [];
      while (pending) {
        if (pending.startsWith(PASTE_START)) {
          const end = pending.indexOf(PASTE_END, PASTE_START.length);
          if (end === -1) break;
          decoded.push(plain(pending.slice(PASTE_START.length, end)));
          pending = pending.slice(end + PASTE_END.length);
          continue;
        }
        if (PASTE_START.startsWith(pending)) break;

        const csi = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(pending);
        if (csi) {
          decoded.push(decodeInput(csi[0]));
          pending = pending.slice(csi[0].length);
          continue;
        }
        if (pending.startsWith("\x1b[")) break;

        const ss3 = /^\x1bO./.exec(pending);
        if (ss3) {
          decoded.push(decodeInput(ss3[0]));
          pending = pending.slice(ss3[0].length);
          continue;
        }
        if (pending === "\x1bO") break;

        if (pending.startsWith("\x1b")) {
          if (pending.length === 1) break;
          decoded.push(decodeInput(pending.slice(0, 2)));
          pending = pending.slice(2);
          continue;
        }

        const nextEscape = pending.indexOf("\x1b");
        const text = nextEscape === -1 ? pending : pending.slice(0, nextEscape);
        decoded.push(...decodeText(text));
        pending = nextEscape === -1 ? "" : pending.slice(nextEscape);
      }
      return decoded;
    },
    reset() {
      pending = "";
    },
  };
}

export function decodeInput(chunk: string): { input: string; key: InputKey } {
  const pasted = chunk.match(/^\x1b\[200~([\s\S]*)\x1b\[201~$/);
  if (pasted) return plain(pasted[1] ?? "");
  if (chunk === "\x1b[200~" || chunk === "\x1b[201~") return plain("");

  const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(chunk);
  if (mouse) {
    const button = Number(mouse[1]);
    const x = Math.max(0, Number(mouse[2]) - 1);
    const y = Math.max(0, Number(mouse[3]) - 1);
    const release = mouse[4] === "m";
    if ((button & 0x40) !== 0) {
      if (release) return plain("");
      return flagged({ mouseWheelUp: (button & 1) === 0, mouseWheelDown: (button & 1) !== 0 });
    }
    if (release) return flagged({ mouse: { kind: "up", x, y } });
    if ((button & 0x20) !== 0) {
      const held = (button & 3) === 0;
      return flagged({ mouse: { kind: held ? "drag" : "move", x, y } });
    }
    if ((button & 3) === 0) return flagged({ mouse: { kind: "down", x, y } });
    return plain("");
  }

  if (chunk === "\x7f" || chunk === "\b") return flagged({ backspace: true });
  if (chunk === "\x1b\x7f" || chunk === "\x1b\b") return flagged({ backspace: true, meta: true });
  if (/^\x1b\[3(?:;\d+)?~$/.test(chunk)) return flagged({ delete: true });

  const enhanced = enhancedKey(chunk);
  if (enhanced) return enhanced;

  const nav = navigation(chunk);
  if (nav) return nav;

  // Unhandled CSI / SS3 — never insert escape garbage as draft text.
  if (/^\x1b\[[0-9;?]*[@-~]$/.test(chunk) || /^\x1bO[A-Z~]$/.test(chunk)) {
    return plain("");
  }

  if (chunk === "\r" || chunk === "\r\n") return flagged({ return: true });
  if (chunk === "\x1b\r" || chunk === "\x1b\n") return flagged({ return: true, meta: true });
  // In raw mode Enter is `\r`. `\n` is Ctrl+J.
  if (chunk === "\n") return { input: "j", key: flagged({ ctrl: true }).key };

  if (chunk === "\t") return flagged({ tab: true });
  if (chunk === "\x1b" || chunk === "\x1b\x1b") {
    return flagged({ escape: true, meta: chunk.length === 2 });
  }

  if (chunk.length === 1 && chunk <= "\x1a") {
    const input = String.fromCharCode(chunk.charCodeAt(0) + "a".charCodeAt(0) - 1);
    return { input, key: flagged({ ctrl: true }).key };
  }

  if (chunk.startsWith("\x1b") && chunk.length === 2) {
    const ch = chunk[1] ?? "";
    return {
      input: ch,
      key: flagged({ meta: true, shift: ch >= "A" && ch <= "Z" }).key,
    };
  }

  if (chunk.startsWith("\x1b")) return flagged({ escape: true });

  if (chunk.length === 1 && chunk >= "A" && chunk <= "Z") {
    return { input: chunk, key: flagged({ shift: true }).key };
  }
  return plain(chunk);
}

/**
 * Kitty CSI-u / xterm modifyOtherKeys sequences.
 *
 * With `enableFocusReporting` we turn on modifyOtherKeys + kitty flags, so
 * Ctrl+C arrives as `CSI 27;5;99 ~` / `CSI 99;5 u` instead of `\x03`. Those
 * must decode to `{ input:"c", ctrl:true }` or they get inserted as garbage
 * and never hit the interrupt binding.
 */
function enhancedKey(chunk: string): { input: string; key: InputKey } | null {
  // CSI u: ESC [ code ; mods u
  const csiU = /^\x1b\[(\d+)(?:;(\d+))?u$/.exec(chunk);
  if (csiU) return decodeEnhancedCode(Number(csiU[1]), modifiers(csiU[2]));
  // modifyOtherKeys: ESC [ 27 ; mods ; code ~
  const modOther = /^\x1b\[27;(\d+);(\d+)~$/.exec(chunk);
  if (modOther) return decodeEnhancedCode(Number(modOther[2]), modifiers(modOther[1]));
  return null;
}

function decodeEnhancedCode(
  code: number,
  flags: Partial<InputKey>,
): { input: string; key: InputKey } | null {
  if (code === 13) return flagged({ return: true, ...flags });
  if (code === 127) return flagged({ backspace: true, ...flags });
  if (code === 9) return flagged({ tab: true, ...flags });
  if (code === 27) return flagged({ escape: true, ...flags });
  // Unicode code point for the key (e.g. 99 = "c" for Ctrl+C).
  if (code >= 32 && code <= 126) {
    const input = String.fromCharCode(code);
    return { input, key: flagged(flags).key };
  }
  return null;
}

function navigation(chunk: string): { input: string; key: InputKey } | null {
  const arrow = /^(\x1b+)(?:\[|O)(?:1;)?(\d+)?([ABCD])$/.exec(chunk);
  if (arrow) {
    const flags = modifiers(arrow[2]);
    if ((arrow[1]?.length ?? 1) > 1) flags.meta = true;
    const which = arrow[3];
    if (which === "A") flags.upArrow = true;
    if (which === "B") flags.downArrow = true;
    if (which === "C") flags.rightArrow = true;
    if (which === "D") flags.leftArrow = true;
    return { input: "", key: flagged(flags).key };
  }

  if (chunk === "\x1b[5~" || chunk === "\x1b[[5~") return flagged({ pageUp: true });
  if (chunk === "\x1b[6~" || chunk === "\x1b[[6~") return flagged({ pageDown: true });
  const page = /^\x1b\[([56]);(\d+)~$/.exec(chunk);
  if (page) {
    const flags = modifiers(page[2]);
    if (page[1] === "5") flags.pageUp = true;
    if (page[1] === "6") flags.pageDown = true;
    return { input: "", key: flagged(flags).key };
  }
  return null;
}

function modifiers(raw: string | undefined): Partial<InputKey> {
  if (!raw) return {};
  const bits = Number(raw) - 1;
  if (!Number.isFinite(bits) || bits <= 0) return {};
  return {
    shift: (bits & 1) !== 0,
    meta: (bits & 2) !== 0,
    ctrl: (bits & 4) !== 0,
  };
}

function plain(input: string): { input: string; key: InputKey } {
  return { input, key: flagged({}).key };
}

/** Keep terminal controls distinct even when stdin batches them with text. */
function decodeText(text: string): Array<{ input: string; key: InputKey }> {
  const out: Array<{ input: string; key: InputKey }> = [];
  let buffered = "";
  const flush = () => {
    if (!buffered) return;
    out.push(plain(buffered));
    buffered = "";
  };
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (char === "\x7f" || code <= 0x1a) {
      flush();
      out.push(decodeInput(char));
    } else {
      buffered += char;
    }
  }
  flush();
  return out;
}

function flagged(partial: Partial<InputKey>): { input: string; key: InputKey } {
  return {
    input: "",
    key: {
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      pageDown: false,
      pageUp: false,
      return: false,
      escape: false,
      ctrl: false,
      shift: false,
      tab: false,
      backspace: false,
      delete: false,
      meta: false,
      mouseWheelUp: false,
      mouseWheelDown: false,
      ...partial,
    },
  };
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
