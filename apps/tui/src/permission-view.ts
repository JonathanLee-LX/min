export const PERMISSION_KEYS = "[y] once   [n] deny   [a] remember";
export const PERMISSION_TIMEOUT = "No answer denies in 2 minutes.";

export type PermissionChoice = "allow" | "deny" | "allow_session";

export function permissionAnswer(input: string): PermissionChoice | null {
  const value = input.trim().toLowerCase();
  if (value === "y" || value === "yes") return "allow";
  if (value === "n" || value === "no") return "deny";
  if (value === "a" || value === "always") return "allow_session";
  return null;
}

/** Detail lines only — keys live in ConfirmInput chrome. */
export function permissionDetailLines(input: {
  reason: string;
  toolCall: { name: string; arguments: unknown };
  grantRoot?: string;
}): string[] {
  const args = brief(input.toolCall.arguments, 240);
  const tool = `${input.toolCall.name} ${args}`;
  if (input.grantRoot) {
    return [
      "Grant session root",
      `  path  ${input.grantRoot}`,
      `  tool  ${tool}`,
      `  ${input.reason}`,
    ];
  }
  return ["Allow tool", `  ${tool}`, `  ${input.reason}`];
}

/** @deprecated Prefer {@link permissionDetailLines} + ConfirmInput. */
export function permissionLines(input: {
  reason: string;
  toolCall: { name: string; arguments: unknown };
  grantRoot?: string;
}): string[] {
  return [
    ...permissionDetailLines(input),
    `  ${PERMISSION_KEYS}${input.grantRoot ? " this root" : " this pattern"}`,
    `  ${PERMISSION_TIMEOUT}`,
  ];
}

function brief(value: unknown, max: number): string {
  let raw: string;
  try {
    raw = JSON.stringify(value) ?? "";
  } catch {
    raw = String(value);
  }
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 3)}...`;
}
