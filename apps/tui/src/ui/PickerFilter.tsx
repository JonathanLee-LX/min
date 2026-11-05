import { Box, Text } from "ink";
import { editorCaret, type EditorState } from "../editor.js";

export const PICKER_FILTER_PLACEHOLDER = "type to filter";

/**
 * One-row filter field for list pickers. Inverse caret matches the composer.
 * Keys include the draft so the first typed character mounts a fresh Text node.
 */
export function PickerFilter({
  filter,
  columns,
  placeholder = PICKER_FILTER_PLACEHOLDER,
}: {
  filter: EditorState;
  columns: number;
  placeholder?: string;
}) {
  const caret = editorCaret(filter);
  const ghost = filter.text.length === 0 ? placeholder : "";
  const width = Math.max(1, columns);
  return (
    <Box height={1} width={width} flexShrink={0}>
      <Text
        key={`picker-filter:${filter.text}:${filter.cursor}:${ghost}`}
        wrap="truncate"
      >
        <Text dimColor>filter </Text>
        {caret.before}
        <Text inverse>{caret.caret}</Text>
        {caret.after}
        {ghost ? <Text dimColor>{ghost}</Text> : null}
      </Text>
    </Box>
  );
}
