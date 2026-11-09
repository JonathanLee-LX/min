/**
 * Small TOML reader for Codex `config.toml`.
 * Covers keys, tables, inline tables, arrays, and comments.
 * Unknown or invalid syntax fails the whole file so the caller can skip it.
 */

export function parseToml(text: string): Record<string, unknown> {
  const parser = new TomlParser(text.replace(/\r\n/g, "\n"));
  return parser.parse();
}

class TomlParser {
  private readonly src: string;
  private i = 0;
  private readonly root: Record<string, unknown> = {};
  private current: Record<string, unknown> = this.root;

  constructor(src: string) {
    this.src = src;
  }

  parse(): Record<string, unknown> {
    while (this.i < this.src.length) {
      this.skipSpaceAndComments();
      if (this.i >= this.src.length) break;
      if (this.src[this.i] === "[") this.readTableHeader();
      else this.readKeyValue(this.current);
      this.skipSpace();
      if (this.i < this.src.length && this.src[this.i] !== "\n" && this.src[this.i] !== "#") {
        throw new Error(`toml: unexpected trailing content at ${this.i}`);
      }
      this.skipLineTail();
    }
    return this.root;
  }

  private readTableHeader(): void {
    const array = this.src[this.i + 1] === "[";
    if (array) throw new Error("toml: array-of-tables is not supported");
    this.i += 1;
    this.skipSpace();
    const keys = this.readKeyPath();
    this.skipSpace();
    if (this.src[this.i] !== "]") throw new Error("toml: expected ] after table name");
    this.i += 1;
    this.current = ensureTable(this.root, keys);
  }

  private readKeyValue(target: Record<string, unknown>): void {
    const keys = this.readKeyPath();
    this.skipSpace();
    if (this.src[this.i] !== "=") throw new Error("toml: expected =");
    this.i += 1;
    this.skipSpace();
    const value = this.readValue();
    assignPath(target, keys, value);
  }

  private readKeyPath(): string[] {
    const keys: string[] = [];
    for (;;) {
      this.skipSpace();
      keys.push(this.readKey());
      this.skipSpace();
      if (this.src[this.i] !== ".") break;
      this.i += 1;
    }
    return keys;
  }

  private readKey(): string {
    const ch = this.src[this.i];
    if (ch === '"' || ch === "'") return this.readString();
    const start = this.i;
    while (this.i < this.src.length && /[A-Za-z0-9_-]/.test(this.src[this.i]!)) this.i += 1;
    if (this.i === start) throw new Error("toml: expected key");
    return this.src.slice(start, this.i);
  }

  private readValue(): unknown {
    this.skipSpace();
    const ch = this.src[this.i];
    if (ch === '"' || ch === "'") return this.readString();
    if (ch === "[") return this.readArray();
    if (ch === "{") return this.readInlineTable();
    if (ch === "t" || ch === "f") return this.readBoolean();
    if (ch === "+" || ch === "-" || ch === "." || (ch !== undefined && /[0-9]/.test(ch))) {
      return this.readNumber();
    }
    throw new Error(`toml: unexpected value at ${this.i}`);
  }

  private readString(): string {
    const quote = this.src[this.i];
    if (quote !== '"' && quote !== "'") throw new Error("toml: expected string");
    const triple = this.src.slice(this.i, this.i + 3) === quote.repeat(3);
    this.i += triple ? 3 : 1;
    if (quote === "'" && !triple) {
      const start = this.i;
      while (this.i < this.src.length && this.src[this.i] !== "'") {
        if (this.src[this.i] === "\n") throw new Error("toml: unterminated string");
        this.i += 1;
      }
      const value = this.src.slice(start, this.i);
      if (this.src[this.i] !== "'") throw new Error("toml: unterminated string");
      this.i += 1;
      return value;
    }
    if (quote === "'" && triple) {
      const start = this.i;
      const end = this.src.indexOf("'''", this.i);
      if (end < 0) throw new Error("toml: unterminated string");
      this.i = end + 3;
      return this.src.slice(start, end);
    }
    let out = "";
    while (this.i < this.src.length) {
      if (!triple && this.src[this.i] === "\n") throw new Error("toml: unterminated string");
      if (triple && this.src.slice(this.i, this.i + 3) === '"""') {
        this.i += 3;
        return out;
      }
      if (!triple && this.src[this.i] === '"') {
        this.i += 1;
        return out;
      }
      if (this.src[this.i] === "\\") {
        this.i += 1;
        out += unescape(this.src[this.i]);
        this.i += 1;
        continue;
      }
      out += this.src[this.i];
      this.i += 1;
    }
    throw new Error("toml: unterminated string");
  }

  private readArray(): unknown[] {
    this.i += 1;
    const out: unknown[] = [];
    for (;;) {
      this.skipSpaceAndComments();
      if (this.src[this.i] === "]") {
        this.i += 1;
        return out;
      }
      out.push(this.readValue());
      this.skipSpaceAndComments();
      if (this.src[this.i] === ",") {
        this.i += 1;
        continue;
      }
      if (this.src[this.i] === "]") {
        this.i += 1;
        return out;
      }
      throw new Error("toml: expected , or ] in array");
    }
  }

  private readInlineTable(): Record<string, unknown> {
    this.i += 1;
    const out: Record<string, unknown> = {};
    for (;;) {
      this.skipSpace();
      if (this.src[this.i] === "}") {
        this.i += 1;
        return out;
      }
      this.readKeyValue(out);
      this.skipSpace();
      if (this.src[this.i] === ",") {
        this.i += 1;
        continue;
      }
      if (this.src[this.i] === "}") {
        this.i += 1;
        return out;
      }
      throw new Error("toml: expected , or } in inline table");
    }
  }

  private readBoolean(): boolean {
    if (this.src.startsWith("true", this.i)) {
      this.i += 4;
      return true;
    }
    if (this.src.startsWith("false", this.i)) {
      this.i += 5;
      return false;
    }
    throw new Error("toml: expected boolean");
  }

  private readNumber(): number {
    const start = this.i;
    if (this.src[this.i] === "+" || this.src[this.i] === "-") this.i += 1;
    while (this.i < this.src.length && /[0-9_eE.+-]/.test(this.src[this.i]!)) this.i += 1;
    const raw = this.src.slice(start, this.i).replace(/_/g, "");
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`toml: invalid number ${raw}`);
    return n;
  }

  private skipSpaceAndComments(): void {
    for (;;) {
      this.skipSpace();
      if (this.src[this.i] === "#") {
        this.skipLineTail();
        continue;
      }
      if (this.src[this.i] === "\n") {
        this.i += 1;
        continue;
      }
      break;
    }
  }

  private skipSpace(): void {
    while (this.i < this.src.length && (this.src[this.i] === " " || this.src[this.i] === "\t")) {
      this.i += 1;
    }
  }

  private skipLineTail(): void {
    while (this.i < this.src.length && this.src[this.i] !== "\n") this.i += 1;
    if (this.src[this.i] === "\n") this.i += 1;
  }
}

function unescape(ch: string | undefined): string {
  switch (ch) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "\\":
    case '"':
      return ch;
    default:
      return ch ?? "";
  }
}

function ensureTable(root: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  let node = root;
  for (const key of keys) {
    const existing = node[key];
    if (existing === undefined) {
      const next: Record<string, unknown> = {};
      node[key] = next;
      node = next;
      continue;
    }
    if (!isPlain(existing)) throw new Error(`toml: cannot nest table under ${keys.join(".")}`);
    node = existing;
  }
  return node;
}

function assignPath(target: Record<string, unknown>, keys: string[], value: unknown): void {
  const last = keys[keys.length - 1];
  if (!last) throw new Error("toml: empty key");
  const parent = keys.length === 1 ? target : ensureTable(target, keys.slice(0, -1));
  if (last in parent && isPlain(parent[last]) && isPlain(value)) {
    Object.assign(parent[last] as Record<string, unknown>, value);
    return;
  }
  parent[last] = value;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
