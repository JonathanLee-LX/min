import { parseMarkdown } from "./markdown.js";
import type { RenderBlock, RenderContent, RenderRequest } from "./types.js";

const fallbackRenderer: RenderContent = (req) => plainRenderer(req, fallbackRenderer);

/**
 * Plugins run first. The built-in Markdown renderer handles assistant text.
 * Everything else stays raw.
 */
export function renderContent(
  req: RenderRequest,
  plugins: readonly RenderContent[] = [],
): RenderBlock[] {
  const chain = [...plugins, markdownRenderer];
  let next: RenderContent = fallbackRenderer;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const current = chain[index]!;
    const after = next;
    next = (request) => current(request, after);
  }
  return next(req, fallbackRenderer);
}

export function markdownRenderer(req: RenderRequest, next: RenderContent): RenderBlock[] {
  if (req.role !== "assistant") return next(req, next);
  return parseMarkdown(req.text, req.streaming);
}

export function plainRenderer(req: RenderRequest, _next: RenderContent): RenderBlock[] {
  const lines = req.text.split("\n").map((line) => [{ text: line, tone: "plain" as const }]);
  return [{ kind: "raw", lines: lines.length > 0 ? lines : [[{ text: "", tone: "plain" }]] }];
}
