/**
 * `@min-agent/render` — Markdown → `RenderBlock` for any host UI.
 *
 * Paint stays in the host (TUI Ink / Web React). Mermaid ASCII stays in the TUI.
 */

export { parseMarkdown } from "./markdown.js";
export { markdownRenderer, plainRenderer, renderContent } from "./render.js";
export type {
  BlockKind,
  RenderBlock,
  RenderContent,
  RenderRequest,
  RenderRole,
  RenderSpan,
  SpanTone,
  TableAlign,
} from "./types.js";
