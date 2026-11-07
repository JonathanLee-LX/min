import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fetchModels, selectModel } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { buildEffortPickerItems, visibleByQuery } from "../../shared/commands";
import type { ModelRow, ModelView, SubmitResponse } from "../../shared/types";

export function ModelDialog({
  open,
  busy,
  onOpenChange,
  onResult,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (result: SubmitResponse) => void;
}) {
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [selection, setSelection] = useState<ModelView | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<ModelRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPending(null);
    setQuery("");
    setError(null);
    setLoading(true);
    void fetchModels()
      .then((data) => {
        setRows(data.models);
        setSelection(data.model);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [open]);

  const efforts = buildEffortPickerItems(selection?.effort);
  const visibleEfforts = visibleByQuery(efforts, query, (item) => `${item.name} ${item.detail}`);
  const visibleModels = visibleByQuery(rows, query, (item) => `${item.name} ${item.detail}`);

  async function choose(key: string, effort?: string) {
    setError(null);
    const result = await selectModel(key, effort);
    onResult(result);
    if (result.ok) onOpenChange(false);
    else setError(result.error ?? result.message ?? "Could not switch model");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pending ? "Thinking intensity" : "Model"}</DialogTitle>
          <DialogDescription>
            {pending
              ? pending.name
              : selection
                ? `${selection.kind} · ${selection.model}`
                : "Choose a model"}
          </DialogDescription>
        </DialogHeader>
        {pending ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => {
              setPending(null);
              setQuery("");
            }}
          >
            <ChevronLeft data-icon="inline-start" />
            Models
          </Button>
        ) : null}
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={pending ? "Filter intensity" : "Filter models"}
          aria-label={pending ? "Filter intensity" : "Filter models"}
          disabled={busy}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {pending
            ? visibleEfforts.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  disabled={busy}
                  className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                  onClick={() => void choose(pending.key, item.value)}
                >
                  <span className="truncate">{item.name}</span>
                  <span className="truncate text-muted-foreground">{item.detail}</span>
                  {item.current ? <Badge>Current</Badge> : <span />}
                </button>
              ))
            : visibleModels.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  disabled={busy}
                  className={cn(
                    "grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-50",
                    item.current && "bg-accent",
                  )}
                  onClick={() => {
                    if (item.supportsEffort) {
                      setPending(item);
                      setQuery("");
                      return;
                    }
                    void choose(item.key);
                  }}
                >
                  <span className="truncate">{item.name}</span>
                  <span className="truncate text-muted-foreground">{item.detail}</span>
                  {item.current ? <Badge>Current</Badge> : <span />}
                </button>
              ))}
          {!loading && !pending && visibleModels.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">No models</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
