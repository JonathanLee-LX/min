import {
  renderContent,
  type RenderBlock,
  type RenderSpan,
  type SpanTone,
  type TableAlign,
} from "@min-agent/render";
import { cn } from "@/lib/utils";

export function MarkdownView({
  text,
  streaming = false,
  className,
}: {
  text: string;
  streaming?: boolean;
  className?: string;
}) {
  const blocks = renderContent({ role: "assistant", text, streaming });
  return (
    <div className={cn("space-y-2 text-sm leading-relaxed", className)}>
      {blocks.map((block, index) => (
        <BlockView key={`${block.kind}-${index}`} block={block} />
      ))}
      {streaming ? <span className="ml-0.5 inline-block animate-pulse">▍</span> : null}
    </div>
  );
}

function BlockView({ block }: { block: RenderBlock }) {
  switch (block.kind) {
    case "heading": {
      const level = Math.min(6, Math.max(1, block.level ?? 1));
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return (
        <Tag className={cn("font-semibold tracking-tight", headingSize(level))}>
          {block.lines.map((line, i) => (
            <Spans key={i} spans={line} />
          ))}
        </Tag>
      );
    }
    case "paragraph":
    case "raw":
      return (
        <div>
          {block.lines.map((line, i) => (
            <p key={i} className="whitespace-pre-wrap">
              <Spans spans={line} />
            </p>
          ))}
        </div>
      );
    case "quote":
      return (
        <blockquote className="border-l-2 border-muted-foreground/40 pl-3 text-muted-foreground">
          {block.lines.map((line, i) => (
            <p key={i}>
              <Spans spans={line} />
            </p>
          ))}
        </blockquote>
      );
    case "list":
      return (
        <ul className="space-y-1">
          {block.lines.map((line, i) => (
            <li key={i} className="whitespace-pre-wrap font-mono text-[0.95em]">
              <Spans spans={line} />
            </li>
          ))}
        </ul>
      );
    case "code":
      return (
        <pre className="overflow-x-auto rounded-md bg-muted/80 p-3 font-mono text-xs">
          {block.lang ? (
            <div className="mb-2 text-[0.7rem] uppercase tracking-wide text-muted-foreground">
              {block.lang}
            </div>
          ) : null}
          <code>
            {block.lines.map((line) => line.map((span) => span.text).join("")).join("\n")}
          </code>
        </pre>
      );
    case "rule":
      return <hr className="border-border" />;
    case "table":
      return <TableView cells={block.cells ?? []} aligns={block.aligns} />;
    default:
      return null;
  }
}

function TableView({
  cells,
  aligns,
}: {
  cells: RenderSpan[][][];
  aligns?: Array<TableAlign | null>;
}) {
  if (cells.length === 0) return null;
  const [header, ...body] = cells;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            {(header ?? []).map((cell, i) => (
              <th
                key={i}
                className="px-2 py-1.5 font-semibold"
                style={{ textAlign: cssAlign(aligns?.[i]) }}
              >
                <Spans spans={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-b border-border/60">
              {row.map((cell, c) => (
                <td
                  key={c}
                  className="px-2 py-1.5"
                  style={{ textAlign: cssAlign(aligns?.[c]) }}
                >
                  <Spans spans={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Spans({ spans }: { spans: readonly RenderSpan[] }) {
  return (
    <>
      {spans.map((span, i) => (
        <span key={i} className={toneClass(span.tone)}>
          {span.text}
        </span>
      ))}
    </>
  );
}

function toneClass(tone: SpanTone): string | undefined {
  switch (tone) {
    case "strong":
      return "font-semibold";
    case "em":
      return "italic";
    case "code":
      return "rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]";
    case "link":
      return "text-primary underline-offset-2 hover:underline";
    case "dim":
      return "text-muted-foreground";
    default:
      return undefined;
  }
}

function headingSize(level: number): string {
  if (level <= 1) return "text-xl";
  if (level === 2) return "text-lg";
  if (level === 3) return "text-base";
  return "text-sm";
}

function cssAlign(align: TableAlign | null | undefined): "left" | "center" | "right" {
  if (align === "center" || align === "right") return align;
  return "left";
}
