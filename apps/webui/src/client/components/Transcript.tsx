import { MarkdownView } from "@/components/MarkdownView";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { LogKind } from "../../shared/transcript";

export interface TranscriptLine {
  id: string;
  kind: LogKind;
  text: string;
}

export function Transcript({
  lines,
  stream,
  thinking,
  toolsOpen,
  thinkingOpen,
  onToggle,
  activity,
}: {
  lines: TranscriptLine[];
  stream: string;
  thinking: string;
  toolsOpen: (id: string) => boolean;
  thinkingOpen: (id: string) => boolean;
  onToggle: (id: string) => void;
  activity: string | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [pinned, setPinned] = useState(true);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const next = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = next;
    setPinned(next);
  }

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, stream, thinking, activity]);

  const empty = lines.length === 0 && !stream && !thinking;

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-3 py-4 md:px-6">
          {empty ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>min</EmptyTitle>
                <EmptyDescription>
                  Ask min to inspect the workspace, edit files, or explain code. Type / for
                  commands.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
          {lines.map((line) => (
            <LineView
              key={line.id}
              line={line}
              open={
                line.kind === "thinking"
                  ? thinkingOpen(line.id)
                  : line.kind === "tool-result" || line.kind === "tool-error"
                    ? toolsOpen(line.id)
                    : true
              }
              onToggle={() => onToggle(line.id)}
            />
          ))}
          {thinking ? (
            <aside className="border-l-2 border-border py-1 pl-3 text-sm text-muted-foreground">
              <p className="whitespace-pre-wrap">{thinking}</p>
            </aside>
          ) : null}
          {stream ? <MarkdownView text={stream} streaming /> : null}
          {activity ? <p className="activity-label w-fit text-sm">{activity}</p> : null}
        </div>
      </div>
      {pinned ? null : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="absolute bottom-3 left-1/2 -translate-x-1/2"
          onClick={() => {
            stick.current = true;
            setPinned(true);
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          Latest
        </Button>
      )}
    </div>
  );
}

function LineView({
  line,
  open,
  onToggle,
}: {
  line: TranscriptLine;
  open: boolean;
  onToggle: () => void;
}) {
  if (line.kind === "user") {
    return (
      <div className="border-l-2 border-user py-1 pl-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{line.text}</p>
      </div>
    );
  }
  if (line.kind === "assistant") return <MarkdownView text={line.text} />;
  if (line.kind === "thinking") {
    return (
      <Fold
        text={line.text}
        open={open}
        onToggle={onToggle}
        className="border-border text-muted-foreground"
        summaryPrefix="thinking"
      />
    );
  }
  if (line.kind === "tool") {
    return (
      <div className="flex items-start gap-2 border-l-2 border-tool py-1 pl-3 text-sm text-tool">
        <span aria-hidden="true">▸</span>
        <span className="min-w-0 break-all font-mono text-xs">{line.text}</span>
      </div>
    );
  }
  if (line.kind === "tool-result" || line.kind === "tool-error") {
    return (
      <Fold
        text={line.text}
        open={open}
        onToggle={onToggle}
        className={line.kind === "tool-error" ? "border-destructive text-destructive" : "border-tool/40 text-muted-foreground"}
      />
    );
  }
  return (
    <pre
      className={cn(
        "whitespace-pre-wrap font-mono text-xs",
        line.kind === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {line.text}
    </pre>
  );
}

function Fold({
  text,
  open,
  onToggle,
  className,
  summaryPrefix,
}: {
  text: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
  summaryPrefix?: string;
}) {
  const foldable = text.includes("\n") || text.length > 80;
  const showFull = open || !foldable;
  const lines = text.split("\n");
  const first = lines.find((line) => line.trim().length > 0)?.trim() ?? "";
  const preview = first.length > 48 ? `${first.slice(0, 47)}…` : first;
  const Icon = showFull ? ChevronDown : ChevronRight;
  return (
    <div className={cn("border-l-2 py-1 pl-3", className)}>
      {foldable ? (
        <button type="button" className="flex w-full items-start gap-2 text-left" onClick={onToggle}>
          <Icon className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1 whitespace-pre-wrap font-mono text-xs">
            {showFull
              ? text
              : `${summaryPrefix ? `${summaryPrefix}: ` : ""}${preview}${lines.length > 1 ? ` · ${lines.length} lines` : ""}`}
          </span>
        </button>
      ) : (
        <p className="whitespace-pre-wrap font-mono text-xs">{text}</p>
      )}
    </div>
  );
}
