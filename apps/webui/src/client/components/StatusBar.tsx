import { Badge } from "@/components/ui/badge";
import { contextPercent } from "@/lib/format";
import type { WebSnapshot } from "../../shared/types";

export function StatusBar({
  snapshot,
  onContext,
  onModel,
}: {
  snapshot: WebSnapshot | null;
  onContext: () => void;
  onModel: () => void;
}) {
  const model = snapshot?.model;
  const modelLabel = model
    ? model.effort
      ? `${model.model} (${model.effort})`
      : model.model
    : snapshot?.provider || "model";
  const usage = snapshot?.context;
  const usageLabel = usage
    ? contextPercent(usage.used, usage.limit, usage.ratio)
    : "—";
  const place = [snapshot?.cwdDisplay || snapshot?.cwd, snapshot?.branch].filter(Boolean).join("  ");

  return (
    <div className="flex flex-col gap-1 border-t px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between md:px-4">
      <p className="min-w-0 truncate" title={snapshot?.cwd}>
        {place || "…"}
      </p>
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" className="min-w-0 truncate hover:text-foreground" onClick={onModel}>
          {modelLabel}
        </button>
        <button type="button" className="shrink-0 hover:text-foreground" onClick={onContext}>
          {usageLabel}
        </button>
        {snapshot && snapshot.queueSize > 0 ? (
          <Badge variant="muted">queue {snapshot.queueSize}</Badge>
        ) : null}
      </div>
    </div>
  );
}
