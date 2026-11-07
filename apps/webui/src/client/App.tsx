import { Composer } from "@/components/Composer";
import { ContextDialog } from "@/components/ContextDialog";
import { ModelDialog } from "@/components/ModelDialog";
import { PermissionBar } from "@/components/PermissionBar";
import { SessionList } from "@/components/SessionList";
import { SlashMenu } from "@/components/SlashMenu";
import { StatusBar } from "@/components/StatusBar";
import { Transcript, type TranscriptLine } from "@/components/Transcript";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  abortRun,
  answerPermission,
  fetchSessions,
  newSession,
  openSession,
  submitText,
} from "@/lib/api";
import { useCoarsePointer } from "@/lib/pointer";
import { cn } from "@/lib/utils";
import { MoreHorizontal, PanelLeft, Plus, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKey } from "react";
import {
  applyCommandCompletion,
  commandPlaceholder,
  commandSuggestions,
  cycleCommandIndex,
  routeSubmit,
  shortSessionId,
  slashMenuEnter,
} from "../shared/commands";
import type { SessionRow, SubmitResponse, WebSnapshot } from "../shared/types";
import {
  activityLabel,
  isTranscriptMessage,
  linesFromMessages,
  summarizeToolCall,
  type LogKind,
} from "../shared/transcript";

type PermissionPrompt = {
  id: string;
  reason: string;
  toolName: string;
  args: string;
  grantRoot?: string;
};

type Wire =
  | { type: "status"; status: WebSnapshot["status"] }
  | { type: "assistant_delta"; text: string }
  | { type: "assistant_done"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_done"; text: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown>; toolCallId: string }
  | {
      type: "tool_end";
      toolCallId: string;
      ok: boolean;
      content: string;
    }
  | { type: "follow_up"; texts: string[] }
  | {
      type: "permission";
      id: string;
      reason: string;
      toolCall: { name: string; arguments: unknown };
      grantRoot?: string;
    }
  | { type: "queued"; queueSize: number }
  | { type: "error"; message: string; aborted?: boolean }
  | { type: "context"; usage: NonNullable<WebSnapshot["context"]> }
  | {
      type: "session";
      id: string;
      title?: string;
      messages?: unknown[];
    }
  | { type: "notice"; message: string }
  | { type: "chrome"; snapshot: WebSnapshot };

const MORE: Array<{ label: string; run?: string; name?: boolean; tools?: boolean }> = [
  { label: "Context", run: "/context" },
  { label: "Compact history", run: "/compact" },
  { label: "Reset history", run: "/reset" },
  { label: "Show queue", run: "/queue" },
  { label: "New session", run: "/new" },
  { label: "Name session", name: true },
  { label: "Thinking", run: "/thinking" },
  { label: "Tool output", tools: true },
  { label: "Help", run: "/help" },
  { label: "Version", run: "/version" },
];

export default function App() {
  const coarse = useCoarsePointer();
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [stream, setStream] = useState("");
  const [thinking, setThinking] = useState("");
  const [input, setInput] = useState("");
  const [completeIndex, setCompleteIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<WebSnapshot["status"]>("idle");
  const [snapshot, setSnapshot] = useState<WebSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [transport, setTransport] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [perm, setPerm] = useState<PermissionPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [toolName, setToolName] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [overrides, setOverrides] = useState<Set<string>>(() => new Set());
  const [focusSignal, setFocusSignal] = useState(0);

  const seq = useRef(0);
  const thinkingExpandedRef = useRef(false);
  const sawStatus = useRef(false);
  const streamRef = useRef("");
  const thinkingRef = useRef("");
  const inflight = useRef(new Map<string, string>());
  const onEvent = useRef<(event: Wire) => void>(() => {});

  const push = useCallback((kind: LogKind, text: string) => {
    seq.current += 1;
    const id = `l${seq.current}`;
    setLines((prev) => {
      const next = [...prev, { id, kind, text }];
      return next.length > 2000 ? next.slice(next.length - 2000) : next;
    });
  }, []);

  const replace = useCallback((messages: unknown[]) => {
    const seeded = linesFromMessages(messages.filter(isTranscriptMessage));
    const next = seeded.map((line) => {
      seq.current += 1;
      return { ...line, id: `l${seq.current}` };
    });
    setLines(next.length > 2000 ? next.slice(next.length - 2000) : next);
    streamRef.current = "";
    thinkingRef.current = "";
    setStream("");
    setThinking("");
    setOverrides(new Set());
  }, []);

  const applySnapshot = useCallback((next: WebSnapshot) => {
    setSnapshot((current) => {
      if (sawStatus.current && current) {
        return { ...next, status: current.status, busy: current.busy };
      }
      return next;
    });
    if (!sawStatus.current) {
      setStatus(next.status);
      setBusy(next.busy);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await fetchSessions());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const applyResult = useCallback(
    (result: SubmitResponse) => {
      if (result.snapshot) applySnapshot(result.snapshot);
      if (result.toggle === "thinking") {
        const next = !thinkingExpandedRef.current;
        thinkingExpandedRef.current = next;
        setThinkingExpanded(next);
        setOverrides(new Set());
        push("sys", next ? "thinking expanded" : "thinking collapsed");
      }
      if (result.message) push(result.level === "error" ? "error" : "sys", result.message);
      if (result.picker === "sessions") {
        setSessionsOpen(true);
        void refreshSessions();
      }
      if (result.picker === "models") setModelOpen(true);
      if (result.error && !result.message) setError(result.error);
      if (result.snapshot) void refreshSessions();
    },
    [applySnapshot, push, refreshSessions],
  );

  onEvent.current = (event) => {
    if (event.type === "status") {
      sawStatus.current = true;
      setStatus(event.status);
      setBusy(event.status !== "idle");
      setSnapshot((current) =>
        current ? { ...current, status: event.status, busy: event.status !== "idle" } : current,
      );
      if (event.status !== "asking") setPerm(null);
      if (event.status === "idle") {
        inflight.current.clear();
        setToolName(null);
        setContinuing(false);
      }
      return;
    }
    if (event.type === "chrome") {
      applySnapshot(event.snapshot);
      setReady(true);
      return;
    }
    if (event.type === "context") {
      setSnapshot((current) => (current ? { ...current, context: event.usage } : current));
      return;
    }
    if (event.type === "session") {
      if (event.messages) replace(event.messages);
      setSnapshot((current) => {
        if (!current) return current;
        return {
          ...current,
          sessionId: event.id,
          ...(typeof event.title === "string" ? { title: event.title } : {}),
        };
      });
      void refreshSessions();
      return;
    }
    if (event.type === "assistant_delta") {
      streamRef.current += event.text;
      setStream(streamRef.current);
      setContinuing(false);
      return;
    }
    if (event.type === "assistant_done") {
      streamRef.current = "";
      thinkingRef.current = "";
      setStream("");
      setThinking("");
      setContinuing(false);
      if (event.text) push("assistant", event.text);
      return;
    }
    if (event.type === "thinking_delta") {
      thinkingRef.current += event.text;
      setThinking(thinkingRef.current);
      return;
    }
    if (event.type === "thinking_done") {
      thinkingRef.current = "";
      setThinking("");
      if (event.text.trim()) push("thinking", event.text.trim());
      return;
    }
    if (event.type === "tool_start") {
      inflight.current.set(event.toolCallId, event.name);
      setToolName(event.name);
      setContinuing(false);
      push("tool", summarizeToolCall(event.name, event.args));
      return;
    }
    if (event.type === "tool_end") {
      inflight.current.delete(event.toolCallId);
      const names = [...inflight.current.values()];
      setToolName(names.length > 0 ? names[names.length - 1]! : null);
      const body = event.content.trim();
      push(event.ok ? "tool-result" : "tool-error", body || (event.ok ? "(no output)" : "(failed)"));
      return;
    }
    if (event.type === "queued") {
      setSnapshot((current) => (current ? { ...current, queueSize: event.queueSize } : current));
      return;
    }
    if (event.type === "follow_up") {
      setContinuing(true);
      push("notice", `follow-up: ${event.texts.join(" | ").slice(0, 160)}`);
      setSnapshot((current) =>
        current
          ? { ...current, queueSize: Math.max(0, current.queueSize - event.texts.length) }
          : current,
      );
      return;
    }
    if (event.type === "error") {
      push("error", event.aborted ? "aborted" : event.message);
      if (!event.aborted) setError(event.message);
      return;
    }
    if (event.type === "notice") {
      push("notice", event.message);
      return;
    }
    if (event.type === "permission") {
      let args = "";
      try {
        args = JSON.stringify(event.toolCall.arguments) ?? "";
      } catch {
        args = "";
      }
      if (args.length > 240) args = `${args.slice(0, 237)}...`;
      setPerm({
        id: event.id,
        reason: event.reason,
        toolName: event.toolCall.name,
        args,
        ...(event.grantRoot ? { grantRoot: event.grantRoot } : {}),
      });
    }
  };

  useEffect(() => {
    const source = new EventSource("/events");
    source.onmessage = (msg) => {
      try {
        onEvent.current(JSON.parse(msg.data) as Wire);
      } catch {
        // ignore malformed frames
      }
    };
    source.onerror = () => setTransport("reconnecting");
    source.onopen = () => setTransport("live");
    return () => source.close();
  }, []);

  useEffect(() => {
    if (!ready) return;
    void refreshSessions();
  }, [ready, snapshot?.sessionId, refreshSessions]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (sessionsOpen || moreOpen || modelOpen || contextOpen) return;
      if (!busy) return;
      event.preventDefault();
      void abortRun();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, contextOpen, modelOpen, moreOpen, sessionsOpen]);

  useEffect(() => {
    setCompleteIndex(0);
  }, [input]);

  async function runLine(text: string) {
    if (pending) return;
    const route = routeSubmit(text, busy);
    if (route.type === "empty") return;
    setError(null);
    if (route.type === "send" || route.type === "queue") push("user", route.text);
    setPending(true);
    try {
      const result = await submitText(text);
      applyResult(result);
      if (!result.ok && !result.message && result.route !== "blocked") setInput(text);
    } catch (err) {
      setInput(text);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  function onSubmit() {
    if (!input.trim()) return;
    const matches = commandSuggestions(input);
    if (matches.length > 0) {
      const command = matches[((completeIndex % matches.length) + matches.length) % matches.length];
      if (!command) return;
      const action = slashMenuEnter(command);
      if (action.type === "fill") {
        setInput(action.text);
        setFocusSignal((current) => current + 1);
        return;
      }
      setInput("");
      void runLine(action.line);
      return;
    }
    const draft = input;
    setInput("");
    void runLine(draft);
  }

  function onComposerKey(event: ReactKey<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    const matches = commandSuggestions(input);
    if (matches.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setCompleteIndex((current) =>
        cycleCommandIndex(current, matches.length, event.key === "ArrowDown" ? "down" : "up"),
      );
      return;
    }
    if (matches.length > 0 && event.key === "Tab") {
      event.preventDefault();
      const next = applyCommandCompletion(input, completeIndex);
      if (next !== null) setInput(next);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    if (coarse && !event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    if (matches.length > 0 && !event.metaKey && !event.ctrlKey) {
      const command = matches[((completeIndex % matches.length) + matches.length) % matches.length];
      if (!command) return;
      const action = slashMenuEnter(command);
      if (action.type === "fill") {
        setInput(action.text);
        return;
      }
      setInput("");
      void runLine(action.line);
      return;
    }
    const draft = input;
    setInput("");
    void runLine(draft);
  }

  function chooseSlash(index: number) {
    const matches = commandSuggestions(input);
    const command = matches[index];
    if (!command) return;
    const action = slashMenuEnter(command);
    if (action.type === "fill") {
      setInput(action.text);
      setFocusSignal((current) => current + 1);
      return;
    }
    setInput("");
    void runLine(action.line);
  }

  async function resume(id: string) {
    setSessionsOpen(false);
    setPending(true);
    try {
      applyResult(await openSession(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  async function startNew() {
    setMoreOpen(false);
    setPending(true);
    try {
      applyResult(await newSession());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  thinkingExpandedRef.current = thinkingExpanded;
  const suggestions = commandSuggestions(input);
  const title =
    snapshot?.title ||
    (snapshot?.sessionId ? shortSessionId(snapshot.sessionId) : "session");
  const activity = activityLabel({
    status,
    streaming: stream.length > 0,
    toolName,
    continuing,
  });
  const placeholder =
    commandPlaceholder(input) ||
    (busy ? "Queue a follow-up…" : "Message min…  / for commands");

  function toolsOpen(id: string) {
    return overrides.has(id) ? !toolsExpanded : toolsExpanded;
  }
  function thinkingOpen(id: string) {
    return overrides.has(id) ? !thinkingExpanded : thinkingExpanded;
  }

  if (!ready) {
    return (
      <div className="mx-auto flex h-dvh w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="min-h-0 flex-1" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Sessions"
          onClick={() => setSessionsOpen(true)}
        >
          <PanelLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold tracking-tight">min</h1>
            <span
              className={cn(
                "size-2 rounded-full",
                transport === "live" ? "bg-user" : "bg-muted-foreground",
              )}
              title={transport}
            />
          </div>
          <p className="truncate text-xs text-muted-foreground">{title}</p>
        </div>
        {busy ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => void abortRun()}>
            <Square data-icon="inline-start" />
            Stop
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="More"
          onClick={() => setMoreOpen(true)}
        >
          <MoreHorizontal />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-80 shrink-0 flex-col border-r md:flex">
          <div className="flex items-center justify-between gap-2 px-3 py-3">
            <h2 className="text-sm font-medium">Sessions</h2>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void startNew()}>
              <Plus data-icon="inline-start" />
              New
            </Button>
          </div>
          <SessionList
            sessions={sessions}
            currentId={snapshot?.sessionId ?? ""}
            query={sessionQuery}
            onQuery={setSessionQuery}
            disabled={busy}
            onOpen={(id) => void resume(id)}
          />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {error ? (
            <Alert variant="destructive" className="m-3 mb-0">
              <AlertDescription className="flex items-start justify-between gap-3">
                <span className="min-w-0 break-words">{error}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => setError(null)}>
                  Dismiss
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          <Transcript
            lines={lines}
            stream={stream}
            thinking={thinking}
            activity={activity}
            toolsOpen={toolsOpen}
            thinkingOpen={thinkingOpen}
            onToggle={(id) => {
              setOverrides((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            }}
          />
          {perm ? (
            <div className="px-3 pb-2 md:px-4">
              <PermissionBar
                reason={perm.reason}
                toolName={perm.toolName}
                args={perm.args}
                grantRoot={perm.grantRoot}
                onAnswer={(answer) => {
                  void answerPermission(perm.id, answer);
                  setPerm(null);
                }}
              />
            </div>
          ) : null}
          <SlashMenu
            commands={suggestions}
            selected={Math.min(completeIndex, Math.max(0, suggestions.length - 1))}
            onHover={setCompleteIndex}
            onChoose={chooseSlash}
          />
          <Separator />
          <div className="pb-[env(safe-area-inset-bottom)]">
            <Composer
              value={input}
              placeholder={placeholder}
              busy={busy}
              disabled={pending}
              coarse={coarse}
              focusSignal={focusSignal}
              onChange={setInput}
              onSubmit={onSubmit}
              onKeyDown={onComposerKey}
            />
            <StatusBar
              snapshot={snapshot}
              onContext={() => setContextOpen(true)}
              onModel={() => setModelOpen(true)}
            />
          </div>
        </main>
      </div>

      <Sheet open={sessionsOpen} onOpenChange={setSessionsOpen}>
        <SheetContent side="left" className="md:hidden">
          <SheetHeader>
            <SheetTitle>Sessions</SheetTitle>
            <SheetDescription>Resume a saved session.</SheetDescription>
          </SheetHeader>
          <SessionList
            sessions={sessions}
            currentId={snapshot?.sessionId ?? ""}
            query={sessionQuery}
            onQuery={setSessionQuery}
            disabled={busy}
            onOpen={(id) => void resume(id)}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Commands</SheetTitle>
            <SheetDescription>Same actions as the terminal slash menu.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-1 overflow-y-auto">
            {MORE.map((item) => (
              <Button
                key={item.label}
                type="button"
                variant="ghost"
                className="justify-start"
                onClick={() => {
                  if (item.tools) {
                    setToolsExpanded((current) => !current);
                    setOverrides(new Set());
                    setMoreOpen(false);
                    return;
                  }
                  if (item.name) {
                    setInput("/name ");
                    setFocusSignal((current) => current + 1);
                    setMoreOpen(false);
                    return;
                  }
                  if (!item.run) return;
                  setMoreOpen(false);
                  void runLine(item.run);
                }}
              >
                {item.tools
                  ? toolsExpanded
                    ? "Collapse tool output"
                    : "Expand tool output"
                  : item.run === "/thinking"
                    ? thinkingExpanded
                      ? "Collapse thinking"
                      : "Expand thinking"
                    : item.label}
              </Button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <ModelDialog
        open={modelOpen}
        busy={busy}
        onOpenChange={setModelOpen}
        onResult={applyResult}
      />
      <ContextDialog
        open={contextOpen}
        usage={snapshot?.context}
        onOpenChange={setContextOpen}
      />
    </div>
  );
}
