import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * What `allow_session` remembers.
 * Bash without shell syntax remembers the first token. Compounds remember
 * the exact command. File tools remember one path. Anything else remembers
 * the tool name.
 */
export type PermissionGrant =
  | { kind: "bash-prefix"; prefix: string }
  | { kind: "bash-exact"; command: string }
  | { kind: "path"; tool: "read_file" | "write_file" | "glob"; path: string }
  | { kind: "tool"; name: string };

export interface PermissionRules {
  version: 1;
  grants: PermissionGrant[];
  /** Absolute sandbox roots approved with allow_session. */
  roots: string[];
}

export type BashShape =
  | { kind: "prefix"; prefix: string }
  | { kind: "exact"; command: string };

const SHELL_META = /[|&;<>`$()\n\r\\"]/;

export function emptyPermissionRules(): PermissionRules {
  return { version: 1, grants: [], roots: [] };
}

/** First-token prefix, or the whole command when shell syntax makes a prefix unsafe. */
export function bashShape(command: string): BashShape | undefined {
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  if (SHELL_META.test(trimmed) || trimmed.includes("'")) {
    return { kind: "exact", command: trimmed };
  }
  const prefix = trimmed.split(/\s+/)[0] ?? "";
  if (!prefix || prefix.includes("=")) {
    return { kind: "exact", command: trimmed };
  }
  return { kind: "prefix", prefix };
}

export function describeGrant(grant: PermissionGrant): string {
  switch (grant.kind) {
    case "bash-prefix":
      return `commands starting with "${grant.prefix}"`;
    case "bash-exact":
      return "this exact command";
    case "path":
      return `path "${grant.path}"`;
    case "tool":
      return `tool "${grant.name}"`;
  }
}

export function sameGrant(a: PermissionGrant, b: PermissionGrant): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "bash-prefix":
      return b.kind === "bash-prefix" && a.prefix === b.prefix;
    case "bash-exact":
      return b.kind === "bash-exact" && a.command === b.command;
    case "path":
      return b.kind === "path" && a.tool === b.tool && a.path === b.path;
    case "tool":
      return b.kind === "tool" && a.name === b.name;
  }
}

export function permissionRulesPath(cwd: string): string {
  return path.join(cwd, ".min", "permissions.json");
}

export function loadPermissionRules(file: string): PermissionRules {
  try {
    const raw = readFileSync(file, "utf8");
    return parsePermissionRules(JSON.parse(raw));
  } catch {
    return emptyPermissionRules();
  }
}

export function savePermissionRules(file: string, rules: PermissionRules): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(rules, null, 2)}\n`, "utf8");
}

export function parsePermissionRules(value: unknown): PermissionRules {
  if (!value || typeof value !== "object") return emptyPermissionRules();
  const record = value as { grants?: unknown; roots?: unknown };
  const grants: PermissionGrant[] = [];
  if (Array.isArray(record.grants)) {
    for (const entry of record.grants) {
      const grant = parseGrant(entry);
      if (grant && !grants.some((existing) => sameGrant(existing, grant))) {
        grants.push(grant);
      }
    }
  }
  const roots: string[] = [];
  if (Array.isArray(record.roots)) {
    for (const root of record.roots) {
      if (typeof root === "string" && root.trim() && !roots.includes(root)) {
        roots.push(root);
      }
    }
  }
  return { version: 1, grants, roots };
}

function parseGrant(value: unknown): PermissionGrant | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as { kind?: unknown; prefix?: unknown; command?: unknown; tool?: unknown; path?: unknown; name?: unknown };
  if (entry.kind === "bash-prefix" && typeof entry.prefix === "string" && entry.prefix) {
    return { kind: "bash-prefix", prefix: entry.prefix };
  }
  if (entry.kind === "bash-exact" && typeof entry.command === "string" && entry.command) {
    return { kind: "bash-exact", command: entry.command };
  }
  if (
    entry.kind === "path" &&
    (entry.tool === "read_file" || entry.tool === "write_file" || entry.tool === "glob") &&
    typeof entry.path === "string" &&
    entry.path
  ) {
    return { kind: "path", tool: entry.tool, path: entry.path };
  }
  if (entry.kind === "tool" && typeof entry.name === "string" && entry.name) {
    return { kind: "tool", name: entry.name };
  }
  return undefined;
}
