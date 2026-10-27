import { Select } from "@inkjs/ui";
import type { CommandSpec } from "../commands.js";

const VISIBLE = 8;

/**
 * Slash-command menu on `@inkjs/ui` Select.
 * Host should ignore ↑↓/Enter/Tab while this is mounted so Select owns those keys.
 */
export function CommandSelect({
  suggestions,
  highlightText,
  onSelect,
  isDisabled = false,
}: {
  suggestions: readonly CommandSpec[];
  /** Typed command prefix without leading slash, for label highlighting. */
  highlightText?: string;
  onSelect: (name: string) => void;
  isDisabled?: boolean;
}) {
  if (suggestions.length === 0) return null;
  const options = suggestions.map((command) => ({
    label: `/${command.name}${command.hint ? `  ${command.hint}` : ""}`,
    value: command.name,
  }));
  const optionKey = options.map((option) => option.value).join("\0");
  return (
    <Select
      key={optionKey}
      options={options}
      visibleOptionCount={Math.min(VISIBLE, options.length)}
      highlightText={highlightText || undefined}
      onChange={onSelect}
      isDisabled={isDisabled}
    />
  );
}

export function commandSelectRows(count: number): number {
  if (count <= 0) return 0;
  return Math.min(VISIBLE, count);
}
