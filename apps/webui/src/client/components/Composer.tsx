import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, Paperclip, X } from "lucide-react";
import { useEffect, useRef, type DragEvent, type KeyboardEvent } from "react";

export interface ComposerAttachment {
  id: string;
  filename: string;
}

export function Composer({
  value,
  placeholder,
  busy,
  disabled,
  coarse,
  attachments,
  onChange,
  onSubmit,
  onKeyDown,
  onAttach,
  onRemoveAttachment,
  focusSignal = 0,
}: {
  value: string;
  placeholder: string;
  busy: boolean;
  disabled?: boolean;
  coarse: boolean;
  attachments: ComposerAttachment[];
  onChange: (value: string) => void;
  onSubmit: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onAttach: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  focusSignal?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 64), 160)}px`;
  }, [value]);

  useEffect(() => {
    if (focusSignal > 0) ref.current?.focus();
  }, [focusSignal]);

  function takeFiles(list: FileList | File[] | null) {
    if (!list || list.length === 0) return;
    onAttach([...list]);
  }

  function onDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    takeFiles(event.dataTransfer.files);
  }

  const canSend = Boolean(value.trim() || attachments.length);

  return (
    <form
      className="flex flex-col gap-2 px-3 py-2 md:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {attachments.length ? (
        <div className="flex flex-wrap gap-1">
          {attachments.map((item) => (
            <span
              key={item.id}
              className="inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
            >
              <span className="truncate">{item.filename}</span>
              <button
                type="button"
                className="shrink-0"
                aria-label={`Remove ${item.filename}`}
                onClick={() => onRemoveAttachment(item.id)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.txt,.md,.json,.csv"
          onChange={(event) => {
            takeFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Attach file"
          className="shrink-0"
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip />
        </Button>
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
          onPaste={(event) => {
            const files = [...event.clipboardData.files].filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length) {
              event.preventDefault();
              onAttach(files);
            }
          }}
        />
        <Button type="submit" disabled={disabled || !canSend} className="shrink-0">
          <ArrowUp data-icon="inline-start" />
          {busy ? "Queue" : "Send"}
        </Button>
      </div>
    </form>
  );
}
