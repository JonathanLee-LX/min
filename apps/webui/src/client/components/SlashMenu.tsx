import { cn } from "@/lib/utils";
import type { CommandSpec } from "../../shared/commands";

export function SlashMenu({
  commands,
  selected,
  onHover,
  onChoose,
}: {
  commands: CommandSpec[];
  selected: number;
  onHover: (index: number) => void;
  onChoose: (index: number) => void;
}) {
  if (commands.length === 0) return null;
  return (
    <div className="max-h-52 overflow-auto border-t bg-popover">
      <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 px-3 py-1 text-xs text-muted-foreground">
        <span>Command</span>
        <span>Action</span>
      </div>
      {commands.map((command, index) => (
        <button
          key={command.name}
          type="button"
          className={cn(
            "grid w-full grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 px-3 py-2 text-left text-sm",
            index === selected ? "bg-accent" : "hover:bg-accent/60",
          )}
          onMouseEnter={() => onHover(index)}
          onClick={() => onChoose(index)}
        >
          <span className="truncate font-mono">/{command.name}</span>
          <span className="truncate text-muted-foreground">{command.hint}</span>
        </button>
      ))}
    </div>
  );
}
