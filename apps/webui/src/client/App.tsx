import { MarkdownView } from "@/components/MarkdownView";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Loader2, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type ChatLine =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "tool"; text: string }
  | { id: string; kind: "sys"; text: string };

type WireMessage = {
  role?: string;
  content?: Array<{ type?: string; text?: string; name?: string; content?: string; isError?: boolean }>;
};

type ClientEvent =
  | { type: "status"; status: string }
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_done"; text: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; preview: string; ok: boolean; name?: string }
  | { type: "permission"; id: string; reason: string }
  | { type: "permission_decision"; id: string; answer: string }
  | { type: "queued"; queueSize: number }
  | { type: "follow_up"; texts: readonly string[] }
  | { type: "error"; message: string; aborted?: boolean }
  | {
      type: "session";
      id: string;
      title?: string;
      messageCount: number;
      reason?: string;
      messages?: WireMessage[];
    }
  | {
      type: "handoff";
      messages: WireMessage[];
      title?: string;
      turn: { text: string; thinking: string; userText?: string };
      permissions: Array<{ id: string; reason: string }>;
      status: { status: string; sessionId: string };
    };

let seq = 0;
const nid = () => `m_${++seq}`;

function linesFromWire(messages: WireMessage[]): ChatLine[] {
  const lines: ChatLine[] = [];
  for (const message of messages) {
    for (const part of message.content ?? []) {
      if (part.type === "text" && part.text?.trim()) {
        const kind = message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : "tool";
        lines.push({ id: nid(), kind, text: part.text.trim() });
      } else if (part.type === "tool_call") {
        lines.push({ id: nid(), kind: "tool", text: `→ ${part.name ?? "tool"}` });
      } else if (part.type === "tool_result") {
        lines.push({
          id: nid(),
          kind: "tool",
          text: `${part.isError ? "ERR " : ""}${part.content ?? ""}`.slice(0, 160),
        });
      }
    }
  }
  return lines;
}

export default function App() {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [stream, setStream] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("connecting");
  const [sessionId, setSessionId] = useState("");
  const [perm, setPerm] = useState<{ id: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef("");

  const push = useCallback((line: Omit<ChatLine, "id"> & { id?: string }) => {
    setLines((prev) => [...prev, { ...line, id: line.id ?? nid() } as ChatLine]);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, stream]);

  useEffect(() => {
    const es = new EventSource("/events");
    es.onmessage = (msg) => {
      let event: ClientEvent;
      try {
        event = JSON.parse(msg.data) as ClientEvent;
      } catch {
        return;
      }
      if (event.type === "status") {
        setStatus(event.status);
        setBusy(event.status !== "idle");
        return;
      }
      if (event.type === "assistant_delta") {
        streamRef.current += event.text;
        setStream(streamRef.current);
        return;
      }
      if (event.type === "assistant_done") {
        streamRef.current = "";
        setStream("");
        if (event.text) push({ kind: "assistant", text: event.text });
        return;
      }
      if (event.type === "tool_start") {
        push({
          kind: "tool",
          text: `→ ${event.name}(${JSON.stringify(event.args).slice(0, 100)})`,
        });
        return;
      }
      if (event.type === "tool_end") {
        push({
          kind: "tool",
          text: `← ${event.ok ? "" : "ERR "}${event.preview.slice(0, 160)}`,
        });
        return;
      }
      if (event.type === "permission") {
        setPerm({ id: event.id, reason: event.reason });
        return;
      }
      if (event.type === "permission_decision") {
        setPerm((current) => (current?.id === event.id ? null : current));
        push({ kind: "sys", text: `permission ${event.answer}` });
        return;
      }
      if (event.type === "handoff") {
        setSessionId(event.status.sessionId);
        setStatus(event.status.status);
        setBusy(event.status.status !== "idle");
        const seeded = linesFromWire(event.messages);
        if (event.turn.userText) {
          seeded.push({ id: nid(), kind: "user", text: event.turn.userText });
        }
        setLines(seeded);
        streamRef.current = event.turn.text;
        setStream(event.turn.text);
        const pending = event.permissions[0];
        setPerm(pending ? { id: pending.id, reason: pending.reason } : null);
        return;
      }
      if (event.type === "queued") {
        push({ kind: "sys", text: `queued (${event.queueSize})` });
        return;
      }
      if (event.type === "follow_up") {
        push({
          kind: "sys",
          text: `follow-up: ${event.texts.join(" | ").slice(0, 120)}`,
        });
        return;
      }
      if (event.type === "error") {
        setError(event.aborted ? null : event.message);
        if (event.message) push({ kind: "sys", text: event.message });
        return;
      }
      if (event.type === "session") {
        setSessionId(event.id);
      }
    };
    es.onerror = () => setStatus("reconnecting");
    es.onopen = () => setStatus("idle");
    return () => es.close();
  }, [push]);

  async function onSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setError(null);
    if (busy) {
      await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      return;
    }
    push({ kind: "user", text });
    streamRef.current = "";
    setStream("");
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? res.statusText);
    }
  }

  async function answerPerm(answer: "allow" | "deny" | "allow_session") {
    if (!perm) return;
    await fetch("/api/permission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: perm.id, answer }),
    });
    setPerm(null);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6">
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-primary">
            min
          </h1>
          <p className="text-sm text-muted-foreground">
            coding agent · {status}
            {sessionId ? ` · ${sessionId}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetch("/api/reset", { method: "POST" }).then(() => setLines([]))}
          >
            Reset
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!busy}
            onClick={() => void fetch("/api/abort", { method: "POST" })}
          >
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        </div>
      </header>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Conversation
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-[420px] flex-1 flex-col p-0">
          <ScrollArea className="h-[420px] px-4 py-4">
            <div className="flex flex-col gap-3">
              {lines.length === 0 && !stream ? (
                <p className="text-sm text-muted-foreground">
                  Ask min to inspect the workspace, edit files, or explain code.
                </p>
              ) : null}
              {lines.map((line) => (
                <div
                  key={line.id}
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed",
                    line.kind === "user" &&
                      "ml-auto bg-primary text-primary-foreground",
                    line.kind === "assistant" && "mr-auto bg-secondary",
                    line.kind === "tool" &&
                      "mr-auto font-mono text-xs text-muted-foreground",
                    line.kind === "sys" &&
                      "mx-auto text-center text-xs text-muted-foreground",
                  )}
                >
                  {line.kind === "assistant" ? (
                    <MarkdownView text={line.text} />
                  ) : (
                    line.text
                  )}
                </div>
              ))}
              {stream ? (
                <div className="mr-auto max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm">
                  <MarkdownView text={stream} streaming />
                </div>
              ) : null}
              {busy && !stream ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  running…
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          {perm ? (
            <div className="flex flex-wrap items-center gap-2 border-t bg-accent/40 px-4 py-3">
              <p className="flex-1 text-sm">Permission: {perm.reason}</p>
              <Button size="sm" onClick={() => void answerPerm("allow")}>
                Allow
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void answerPerm("allow_session")}
              >
                Remember
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void answerPerm("deny")}
              >
                Deny
              </Button>
            </div>
          ) : null}

          <form
            className="flex gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void onSend();
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={busy ? "Queue a follow-up…" : "Message min…"}
              autoFocus
            />
            <Button type="submit">{busy ? "Queue" : "Send"}</Button>
          </form>
          {error ? (
            <p className="px-4 pb-3 text-xs text-destructive">{error}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
