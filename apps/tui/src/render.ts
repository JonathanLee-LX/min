/**
 * Re-export the shared Markdown → RenderBlock pipeline.
 * Terminal painting stays in `paint.ts`; mermaid stays in `mermaid.ts`.
 */
export {
  markdownRenderer,
  plainRenderer,
  renderContent,
  type BlockKind,
  type RenderBlock,
  type RenderContent,
  type RenderRequest,
  type RenderRole,
  type RenderSpan,
  type SpanTone,
  type TableAlign,
} from "@min-agent/render";
