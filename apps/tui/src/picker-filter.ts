import { reduceEditor, type EditorOp, type EditorState } from "./editor.js";
import type { EffortPickItem, ModelPickItem, SessionListItem } from "./commands.js";

/** Case-insensitive substring match; blank query keeps every item. */
export function matchesPickerFilter(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const hay = haystack.toLowerCase();
  return needle.split(/\s+/).every((token) => hay.includes(token));
}

export function filterPickerItems<T>(
  items: readonly T[],
  query: string,
  haystack: (item: T) => string,
): T[] {
  return items.filter((item) => matchesPickerFilter(haystack(item), query));
}

export function sessionFilterHaystack(session: SessionListItem): string {
  return [session.id, session.title, session.preview, session.latest].filter(Boolean).join(" ");
}

export function modelFilterHaystack(item: { name: string; detail?: string }): string {
  return [item.name, item.detail].filter(Boolean).join(" ");
}

export function visibleSessions(
  sessions: readonly SessionListItem[],
  query: string,
): SessionListItem[] {
  return filterPickerItems(sessions, query, sessionFilterHaystack);
}

export function visibleModels(items: readonly ModelPickItem[], query: string): ModelPickItem[] {
  return filterPickerItems(items, query, modelFilterHaystack);
}

export function visibleEfforts(items: readonly EffortPickItem[], query: string): EffortPickItem[] {
  return filterPickerItems(items, query, modelFilterHaystack);
}

/** Typing, deletion, and caret motion; arrows and newlines stay on the list. */
export function reducePickerFilter(state: EditorState, op: EditorOp): EditorState {
  if (op.op === "up" || op.op === "down" || op.op === "newline") return state;
  if (op.op === "insert") {
    const text = op.text.replace(/\r\n/g, " ").replace(/[\r\n]/g, "");
    if (!text) return state;
    return reduceEditor(state, { op: "insert", text });
  }
  return reduceEditor(state, op);
}

/**
 * Apply a filter keystroke and keep the highlighted item when it still matches.
 * Falls back to the first remaining row.
 */
export function applyPickerFilter<T>(
  items: readonly T[],
  selected: number,
  filter: EditorState,
  op: EditorOp,
  keyOf: (item: T) => string,
  haystack: (item: T) => string,
): { filter: EditorState; selected: number; visible: T[] } {
  const previous = filterPickerItems(items, filter.text, haystack);
  const nextFilter = reducePickerFilter(filter, op);
  const visible = filterPickerItems(items, nextFilter.text, haystack);
  const current = previous[selected];
  const retained = current ? visible.findIndex((item) => keyOf(item) === keyOf(current)) : 0;
  return {
    filter: nextFilter,
    selected: retained >= 0 ? retained : 0,
    visible,
  };
}
