import { createHash, randomBytes } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TextEdit {
  old_string: string;
  new_string: string;
  replace_all: boolean;
}

export interface TextEditInput {
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  edits?: Array<{
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  }>;
}

const DIFF_LINE = 100;
const DIFF_LINES = 4;
const DIFF_CHARS = 600;

export function contentHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Exact UTF-8 text, or a refusal for NUL bytes and sequences that do not round-trip. */
export function inspectText(buf: Buffer): { ok: true; text: string } | { ok: false } {
  if (buf.includes(0)) return { ok: false };
  const text = buf.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buf)) return { ok: false };
  return { ok: true, text };
}

export function normalizeEdits(
  input: TextEditInput,
): { ok: true; edits: TextEdit[] } | { ok: false; message: string } {
  const hasEdits = input.edits !== undefined;
  const hasSingle =
    input.old_string !== undefined ||
    input.new_string !== undefined ||
    input.replace_all !== undefined;
  if (hasEdits && hasSingle) {
    return {
      ok: false,
      message: "Pass old_string and new_string, or edits, not both.",
    };
  }
  if (hasEdits) {
    const edits = input.edits ?? [];
    if (edits.length === 0) {
      return { ok: false, message: "edits is empty. Provide at least one replacement." };
    }
    return {
      ok: true,
      edits: edits.map((edit) => ({
        old_string: edit.old_string,
        new_string: edit.new_string,
        replace_all: edit.replace_all === true,
      })),
    };
  }
  if (input.old_string === undefined || input.new_string === undefined) {
    return { ok: false, message: "Pass old_string and new_string, or an edits array." };
  }
  return {
    ok: true,
    edits: [
      {
        old_string: input.old_string,
        new_string: input.new_string,
        replace_all: input.replace_all === true,
      },
    ],
  };
}

export function applyTextEdits(
  original: string,
  edits: readonly TextEdit[],
  displayPath: string,
): { ok: true; text: string; replacements: number } | { ok: false; message: string } {
  let text = original;
  let replacements = 0;
  for (const [index, edit] of edits.entries()) {
    const prefix = edits.length > 1 ? `edit ${index + 1}: ` : "";
    if (edit.old_string.length === 0) {
      return { ok: false, message: `${prefix}old_string is empty.` };
    }
    const count = countOccurrences(text, edit.old_string);
    if (count === 0) {
      return {
        ok: false,
        message: `${prefix}old_string not found in ${displayPath}. Add surrounding context so it matches exactly.`,
      };
    }
    if (!edit.replace_all && count !== 1) {
      return {
        ok: false,
        message: `${prefix}old_string matched ${count} times in ${displayPath}. Add surrounding context so it matches once, or set replace_all.`,
      };
    }
    text = edit.replace_all
      ? text.split(edit.old_string).join(edit.new_string)
      : replaceOnce(text, edit.old_string, edit.new_string);
    replacements += count;
  }
  return { ok: true, text, replacements };
}

/** Short old/new preview for a permission prompt. Does not read the file. */
export function conciseEditDiff(input: Record<string, unknown>): string {
  const normalized = normalizeEdits(coerceEditInput(input));
  if (!normalized.ok) return "";
  const lines: string[] = [];
  for (const [index, edit] of normalized.edits.entries()) {
    if (normalized.edits.length > 1 || edit.replace_all) {
      const label = normalized.edits.length > 1 ? `${index + 1}. ` : "";
      lines.push(`${label}${edit.replace_all ? "replace all" : "replace"}`);
    }
    lines.push(...clipBlock("-", edit.old_string));
    lines.push(...clipBlock("+", edit.new_string));
  }
  let text = lines.join("\n");
  if (text.length > DIFF_CHARS) text = `${text.slice(0, DIFF_CHARS - 1)}…`;
  return text;
}

/** Replace the destination via a temp file in the same directory. */
export async function writeTextAtomic(abs: string, text: string): Promise<void> {
  const dir = path.dirname(abs);
  const tmp = path.join(
    dir,
    `.${path.basename(abs)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    await writeFile(tmp, Buffer.from(text, "utf8"), { flag: "wx" });
    await rename(tmp, abs);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

function coerceEditInput(input: Record<string, unknown>): TextEditInput {
  const edits = Array.isArray(input.edits)
    ? input.edits.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        if (typeof record.old_string !== "string" || typeof record.new_string !== "string") {
          return [];
        }
        return [
          {
            old_string: record.old_string,
            new_string: record.new_string,
            replace_all: record.replace_all === true ? true : undefined,
          },
        ];
      })
    : undefined;
  return {
    old_string: typeof input.old_string === "string" ? input.old_string : undefined,
    new_string: typeof input.new_string === "string" ? input.new_string : undefined,
    replace_all: typeof input.replace_all === "boolean" ? input.replace_all : undefined,
    edits,
  };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

function replaceOnce(haystack: string, needle: string, replacement: string): string {
  const at = haystack.indexOf(needle);
  return haystack.slice(0, at) + replacement + haystack.slice(at + needle.length);
}

function clipBlock(prefix: string, text: string): string[] {
  const raw = text.split("\n");
  const shown = raw.slice(0, DIFF_LINES).map((line) => {
    const clipped = line.length > DIFF_LINE ? `${line.slice(0, DIFF_LINE - 1)}…` : line;
    return `${prefix} ${clipped}`;
  });
  if (raw.length > DIFF_LINES) shown.push(`${prefix} …`);
  if (shown.length === 0) shown.push(`${prefix} `);
  return shown;
}
