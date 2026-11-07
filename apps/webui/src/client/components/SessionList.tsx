import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { sessionWhen, shortSessionId, turnLabel, type SessionListItem } from "../../shared/commands";

const COLUMNS = "grid-cols-[minmax(8rem,1.4fr)_minmax(8rem,1fr)_4.75rem_6.75rem_4.75rem]";

export function SessionList({
  sessions,
  currentId,
  query,
  onQuery,
  onOpen,
  disabled,
}: {
  sessions: SessionListItem[];
  currentId: string;
  query: string;
  onQuery: (value: string) => void;
  onOpen: (id: string) => void;
  disabled?: boolean;
}) {
  const q = query.trim().toLowerCase();
  const visible = q
    ? sessions.filter((session) =>
        [session.title, session.preview, session.latest, session.id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      )
    : sessions;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Filter sessions"
        aria-label="Filter sessions"
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[36rem]">
          <div
            className={cn(
              "grid items-center gap-2 px-2 py-1 text-xs text-muted-foreground",
              COLUMNS,
            )}
          >
            <span>Name</span>
            <span>Latest</span>
            <span>Turns</span>
            <span>When</span>
            <span>Id</span>
          </div>
          {visible.length === 0 ? (
            <p className="px-2 py-6 text-sm text-muted-foreground">
              {sessions.length === 0 ? "No saved sessions" : "No matches"}
            </p>
          ) : (
            visible.map((session) => {
              const name = session.title || session.preview || "(untitled)";
              const latest =
                session.latest && session.latest !== name ? session.latest : "";
              const current = session.id === currentId;
              return (
                <button
                  key={session.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onOpen(session.id)}
                  className={cn(
                    "grid w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-50",
                    COLUMNS,
                    current && "bg-accent",
                  )}
                >
                  <span className="truncate">{current ? `* ${name}` : name}</span>
                  <span className="truncate text-muted-foreground">{latest}</span>
                  <span className="text-muted-foreground">{turnLabel(session.turns)}</span>
                  <span className="text-muted-foreground">{sessionWhen(session.updatedAt)}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {shortSessionId(session.id)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
