import { inputAction, type InputAction, type InputKey } from "./editor.js";

/**
 * Turn one raw stdin chunk into the editor action.
 *
 * The Backspace key (删除键) sends DEL (`\x7f`) on macOS, Linux, and Windows
 * Terminal. Ink's `useInput` labels that byte `delete`, which is forward
 * delete, so a press at the end of the line removes nothing. Forward delete
 * is the separate sequence `\x1b[3~`.
 */
export function actionFromChunk(chunk: string): InputAction {
  const decoded = decodeInput(chunk);
  return inputAction(decoded.input, decoded.key);
}

export function decodeInput(chunk: string): { input: string; key: InputKey } {
  const pasted = chunk.match(/^\x1b\[200~([\s\S]*)\x1b\[201~$/);
  if (pasted) return plain(pasted[1] ?? "");
  if (chunk === "\x1b[200~" || chunk === "\x1b[201~") return plain("");

  if (chunk === "\x7f" || chunk === "\b") return flagged({ backspace: true });
  if (chunk === "\x1b\x7f" || chunk === "\x1b\b") return flagged({ backspace: true, meta: true });
  if (/^\x1b\[127(?:;\d+)?u$/.test(chunk)) return flagged({ backspace: true });
  if (/^\x1b\[3(?:;\d+)?~$/.test(chunk)) return flagged({ delete: true });

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

  const nav = navigation(chunk);
  if (nav) return nav;

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
