import { useEffect, useId, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

let renderChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = renderChain.then(task, task);
  renderChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function MermaidBlock({ source }: { source: string }) {
  const reactId = useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    void enqueue(async () => {
      const mod = await import("mermaid");
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
        fontFamily: "inherit",
      });
      return mermaid.render(`diagram-${reactId}`, source);
    })
      .then((result) => {
        if (!cancelled) setSvg(result.svg);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reactId, source]);

  if (failed) {
    return (
      <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
        <code>{source}</code>
      </pre>
    );
  }
  if (!svg) return <Skeleton className="h-24 w-full" />;
  return (
    <div
      className="overflow-x-auto rounded-md bg-muted/50 p-3"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
