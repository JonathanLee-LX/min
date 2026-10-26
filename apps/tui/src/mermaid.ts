import { renderMermaidASCII } from "beautiful-mermaid";
import { displayWidth, wrapText } from "./text.js";

/**
 * Draw a mermaid fence as terminal text.
 * Returns null when the source is not a diagram the renderer accepts,
 * so the caller can keep showing the fence as code.
 */
export function renderMermaidLines(source: string, columns: number): string[] | null {
  const width = Math.max(1, columns);
  let rendered: string[] | null = null;
  for (const useAscii of [false, true]) {
    let text: string;
    try {
      text = renderMermaidASCII(source, {
        colorMode: "none",
        useAscii,
        paddingX: useAscii ? 1 : 2,
        paddingY: 0,
        boxBorderPadding: 1,
      });
    } catch {
      return null;
    }
    const lines = trimEdges(text.split("\n"));
    if (lines.length === 0) return null;
    rendered = lines;
    if (lines.every((line) => displayWidth(line) <= width)) return lines;
  }
  if (!rendered) return null;
  return rendered.flatMap((line) => wrapText(line.length > 0 ? line : " ", width));
}

function trimEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !(lines[start] ?? "").trim()) start += 1;
  while (end > start && !(lines[end - 1] ?? "").trim()) end -= 1;
  return lines.slice(start, end);
}
