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

export function decodeInput(chunk: string): { input: string; key: InputKey } {
  const pasted = chunk.match(/^\x1b\[200~([\s\S]*)\x1b\[201~$/);
  if (pasted) return plain(pasted[1] ?? "");
  if (chunk === "\x1b[200~" || chunk === "\x1b[201~") return plain("");

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
  const arrow = /^\x1b(?:\[|O)(?:1;)?(\d+)?([ABCD])$/.exec(chunk);
  if (arrow) {
    const flags = modifiers(arrow[1]);
    const which = arrow[2];
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
      ...partial,
    },
  };
}
