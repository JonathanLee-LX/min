import { ConfirmInput } from "@inkjs/ui";
import { Box, Text } from "ink";
import { permissionDetailLines } from "../permission-view.js";
import type { TuiTheme } from "../theme.js";

/**
 * Permission chrome on `@inkjs/ui` ConfirmInput (Y/n).
 * Press `a` (handled by the host) to remember for the session.
 */
export function PermissionPrompt({
  pending,
  theme,
  onAllow,
  onDeny,
}: {
  pending: {
    reason: string;
    toolCall: { name: string; arguments: unknown };
    grantRoot?: string;
  };
  theme: TuiTheme;
  onAllow: () => void;
  onDeny: () => void;
}) {
  const lines = permissionDetailLines(pending);
  return (
    <Box flexDirection="column" marginTop={1} flexShrink={0}>
      {lines.map((line, index) => (
        <Text
          key={`${index}:${line}`}
          color={index === 0 ? theme.chrome.permission : undefined}
          dimColor={index > 0}
          wrap="wrap"
        >
          {line}
        </Text>
      ))}
      <Box gap={1}>
        <Text>Allow once?</Text>
        <ConfirmInput onConfirm={onAllow} onCancel={onDeny} defaultChoice="confirm" />
      </Box>
      <Text dimColor>Y once · N deny · A remember · idle denies in 2 minutes</Text>
    </Box>
  );
}

/** Rows reserved for the permission block (details + confirm + hint). */
export function permissionPromptRows(pending: {
  reason: string;
  toolCall: { name: string; arguments: unknown };
  grantRoot?: string;
} | null): number {
  if (!pending) return 0;
  // marginTop(1) + detail lines + confirm row + hint row
  return 1 + permissionDetailLines(pending).length + 2;
}
