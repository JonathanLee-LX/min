import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { contextPercent, formatTokens } from "@/lib/format";
import type { ContextUsageView } from "../../shared/types";

export function ContextDialog({
  open,
  usage,
  onOpenChange,
}: {
  open: boolean;
  usage?: ContextUsageView;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Context</DialogTitle>
          <DialogDescription>
            {usage
              ? `${contextPercent(usage.used, usage.limit, usage.ratio)}${usage.strategy ? ` · ${usage.strategy}` : ""}`
              : "No usage yet. Send a message first."}
          </DialogDescription>
        </DialogHeader>
        {usage ? (
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            {usage.parts.map((part) => (
              <div key={part.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>{part.label}</span>
                  <span className="text-muted-foreground">
                    {formatTokens(part.tokens)} {Math.round(part.share * 100)}%
                  </span>
                </div>
                <Progress value={part.share * 100} label={part.label} />
              </div>
            ))}
            {usage.estimated ? (
              <p className="text-xs text-muted-foreground">Estimated · chars÷4</p>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
