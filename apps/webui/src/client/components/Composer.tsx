import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

export function Composer({
  value,
  placeholder,
  busy,
  disabled,
  coarse,
  onChange,
  onSubmit,
  onKeyDown,
  focusSignal = 0,
}: {
  value: string;
  placeholder: string;
  busy: boolean;
  disabled?: boolean;
  coarse: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  focusSignal?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 64), 160)}px`;
  }, [value]);

  useEffect(() => {
    if (focusSignal > 0) ref.current?.focus();
  }, [focusSignal]);

  return (
    <form
      className="flex items-end gap-2 px-3 py-2 md:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Textarea
        ref={ref}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        rows={2}
        enterKeyHint={coarse ? "enter" : "send"}
        autoCapitalize="none"
        autoCorrect="off"
        aria-label="Message"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <Button type="submit" disabled={disabled || !value.trim()} className="shrink-0">
        <ArrowUp data-icon="inline-start" />
        {busy ? "Queue" : "Send"}
      </Button>
    </form>
  );
}
